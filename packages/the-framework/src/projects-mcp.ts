import { z } from 'zod'
import { McpServer, McpTool, McpResponse } from '@gemstack/mcp'
import type { McpToolResult, McpServerOptions, ZodLikeObject } from '@gemstack/mcp'
import { addProject, listProjects, nodeRegistryFs, type RegistryFs } from './registry.js'
import { appendControl, type ControlEntry } from './control.js'
import type { ClaudeCodeDriverOptions, McpServerSpec } from './driver/index.js'

/**
 * The projects MCP server (spike for #1121): the tools a project-less "topic" run (#1120) uses to
 * bind itself to a project mid-run. Instead of a gate the run parks on, the agent calls a tool:
 * `list_projects` to see what is registered, `create_project` to register one and bind this run to
 * it. The bind is signalled back to the run over the same control channel the dashboard steers with.
 *
 * Authored on @gemstack/mcp directly rather than @gemstack/mcp-connectors because the connector
 * layer namespaces + kebab-cases tool names (its ids reject `_`), and the agent-facing names here
 * are `list_projects` / `create_project` verbatim.
 */

/** Env var carrying the topic run's cwd to the spawned server, so `create_project` can signal it. */
export const RUN_CWD_ENV = 'FRAMEWORK_RUN_CWD'

/** Injectable seams so the server is unit-testable without disk or a real registry. */
export interface ProjectsMcpDeps {
  /** Registry env (resolves the registry file path). Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** The topic run's cwd, where the bind control entry is appended. Absent = no signal. */
  runCwd?: string | undefined
  fs?: RegistryFs
  /** Clock for a new project's `addedAt`. Default wall clock. */
  now?: () => string
  /** Append seam for the bind control entry. Default {@link appendControl}. */
  append?: (cwd: string, entry: ControlEntry) => Promise<void>
}

interface ResolvedDeps {
  env: NodeJS.ProcessEnv
  runCwd: string | undefined
  fs: RegistryFs
  now: () => string
  append: (cwd: string, entry: ControlEntry) => Promise<void>
}

function resolve(deps: ProjectsMcpDeps): ResolvedDeps {
  return {
    env: deps.env ?? process.env,
    runCwd: deps.runCwd,
    fs: deps.fs ?? nodeRegistryFs(),
    now: deps.now ?? (() => new Date().toISOString()),
    append: deps.append ?? appendControl,
  }
}

function listProjectsTool(deps: ResolvedDeps): new () => McpTool {
  return class extends McpTool {
    override name(): string {
      return 'list_projects'
    }
    override description(): string {
      return 'List the projects registered with The Framework, so this run can bind to one.'
    }
    override schema(): ZodLikeObject {
      return z.object({})
    }
    override async handle(): Promise<McpToolResult> {
      return McpResponse.json({ projects: await listProjects(deps.fs, deps.env) })
    }
  }
}

function createProjectTool(deps: ResolvedDeps): new () => McpTool {
  return class extends McpTool {
    override name(): string {
      return 'create_project'
    }
    override description(): string {
      return 'Register a project by its absolute path and bind this run to it.'
    }
    override schema(): ZodLikeObject {
      return z.object({ path: z.string().min(1) })
    }
    override async handle(input: Record<string, unknown>): Promise<McpToolResult> {
      const path = String(input['path'] ?? '')
      const project = await addProject(path, deps.now(), deps.fs, deps.env)
      // Signal the run so the bind lands on its meta (#1121). The worktree re-home / respawn is
      // #1122 — a bound run keeps executing in its scratch dir until that ships.
      if (deps.runCwd) await deps.append(deps.runCwd, { kind: 'bind', projectId: project.id })
      return McpResponse.json({ project, bound: deps.runCwd !== undefined })
    }
  }
}

/** The projects MCP server class, its tools closing over {@link deps}. */
export function makeProjectsServer(deps: ProjectsMcpDeps = {}): new (o?: McpServerOptions) => McpServer {
  const resolved = resolve(deps)
  const tools = [listProjectsTool(resolved), createProjectTool(resolved)]
  return class extends McpServer {
    protected override tools = tools
    override metadata() {
      return {
        name: 'the-framework-projects',
        version: '1.0.0',
        instructions: 'Bind this project-less run to a project: list_projects, then create_project.',
      }
    }
  }
}

/** Run the projects server over stdio until the process exits (the `mcp-projects` subcommand). */
export async function runProjectsMcp(deps: ProjectsMcpDeps = {}): Promise<void> {
  // Dynamic import so the @modelcontextprotocol/sdk transport never enters the static graph of
  // anything the client bundle can reach; only this subcommand pulls it.
  const { startStdio } = await import('@gemstack/mcp/runtime')
  const Server = makeProjectsServer(deps)
  await startStdio(new Server())
}

/**
 * The `mcpServers` spec that spawns this server for a run, mirroring {@link browserMcpServers}.
 * The framework spawns itself (`node <bin> mcp-projects`) and hands the child the run's cwd plus the
 * config-home vars, so the spawned server resolves the same registry file the daemon does.
 */
export function projectsMcpServers(
  binPath: string,
  runCwd: string,
  env: NodeJS.ProcessEnv,
): Record<string, McpServerSpec> {
  const childEnv: Record<string, string> = { [RUN_CWD_ENV]: runCwd }
  if (env.XDG_CONFIG_HOME) childEnv.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME
  if (env.HOME) childEnv.HOME = env.HOME
  return { projects: { command: process.execPath, args: [binPath, 'mcp-projects'], env: childEnv } }
}

/** Fold the projects MCP server into driver options for a topic run (#1121). Non-topic runs skip it. */
export function withProjectsMcp(
  base: ClaudeCodeDriverOptions,
  topic: boolean | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  binPath: string | undefined = process.argv[1],
): ClaudeCodeDriverOptions {
  if (!topic || !binPath) return base
  return { ...base, mcpServers: { ...base.mcpServers, ...projectsMcpServers(binPath, cwd, env) } }
}
