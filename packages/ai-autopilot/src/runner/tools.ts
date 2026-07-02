import { z } from 'zod'
import { toolDefinition, type AnyTool } from '@gemstack/ai-sdk'
import type { RunnerSession } from './types.js'

/** Control which sandbox tools are exposed to the agent. */
export interface RunnerToolsOptions {
  /**
   * Prefix for every tool name (e.g. `sandbox` → `sandbox_exec`). Useful when a
   * persona already has a same-named tool. Default: no prefix.
   */
  prefix?: string
  /** Expose `write_file` / `remove_file`. Default `true`. */
  write?: boolean
  /**
   * Expose the `exec` tool. Default `true`. Set `false` for a read-only surface
   * (inspect files + preview, but no arbitrary command execution).
   */
  exec?: boolean
}

/**
 * Expose a booted {@link RunnerSession} to an agent as `ai-sdk` tools, so a
 * persona can act inside the sandbox: read/write files, run commands, and get a
 * preview URL. This is the bridge between the runner seam and the agent layer.
 *
 * The `preview` tool is included only when the session supports it
 * (`session.preview` is defined) — capability is detected, not assumed.
 */
export function runnerTools(session: RunnerSession, opts: RunnerToolsOptions = {}): AnyTool[] {
  const name = (base: string) => (opts.prefix ? `${opts.prefix}_${base}` : base)
  const tools: AnyTool[] = []

  tools.push(
    toolDefinition({
      name: name('read_file'),
      description: 'Read a file from the sandbox workspace.',
      inputSchema: z.object({ path: z.string().describe('Workspace-relative path.') }),
    }).server(async ({ path }) => session.fs.read(path)) as unknown as AnyTool,
  )

  tools.push(
    toolDefinition({
      name: name('list_files'),
      description: 'List files in the sandbox workspace, optionally under a directory.',
      inputSchema: z.object({ dir: z.string().optional().describe('Directory to list; root if omitted.') }),
    }).server(async ({ dir }) => ({ files: await session.fs.list(dir) })) as unknown as AnyTool,
  )

  if (opts.write !== false) {
    tools.push(
      toolDefinition({
        name: name('write_file'),
        description: 'Create or overwrite a file in the sandbox workspace.',
        inputSchema: z.object({
          path: z.string().describe('Workspace-relative path.'),
          contents: z.string().describe('Full file contents.'),
        }),
      })
        .server(async ({ path, contents }) => {
          await session.fs.write(path, contents)
          return { ok: true, path }
        })
        .modelOutput(r => `wrote ${r.path}`) as unknown as AnyTool,
    )

    tools.push(
      toolDefinition({
        name: name('remove_file'),
        description: 'Delete a file from the sandbox workspace.',
        inputSchema: z.object({ path: z.string().describe('Workspace-relative path.') }),
      })
        .server(async ({ path }) => {
          await session.fs.remove(path)
          return { ok: true, path }
        })
        .modelOutput(r => `removed ${r.path}`) as unknown as AnyTool,
    )
  }

  if (opts.exec !== false) {
    tools.push(
      toolDefinition({
        name: name('exec'),
        description: 'Run a shell command in the sandbox and return stdout, stderr, and exit code.',
        inputSchema: z.object({
          command: z.string().describe('The shell command to run.'),
          cwd: z.string().optional().describe('Working directory, relative to the workspace root.'),
        }),
      })
        .server(async ({ command, cwd }) => session.exec(command, cwd ? { cwd } : {}))
        .modelOutput(r => `exit ${r.exitCode}\n${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`) as unknown as AnyTool,
    )
  }

  if (opts.exec !== false && session.start) {
    const start = session.start.bind(session)
    tools.push(
      toolDefinition({
        name: name('start_server'),
        description: 'Start a long-running command (e.g. a dev server) in the background. Returns immediately; use preview to get its URL.',
        inputSchema: z.object({
          command: z.string().describe('The shell command to start (e.g. "npm run dev").'),
          cwd: z.string().optional().describe('Working directory, relative to the workspace root.'),
        }),
      })
        .server(async ({ command, cwd }) => {
          await start(command, cwd ? { cwd } : {})
          return { started: command }
        })
        .modelOutput(r => `started ${r.started}`) as unknown as AnyTool,
    )
  }

  if (session.preview) {
    const preview = session.preview.bind(session)
    tools.push(
      toolDefinition({
        name: name('preview'),
        description: 'Expose the running dev server and return its preview URL.',
        inputSchema: z.object({ port: z.number().int().positive().optional().describe('Dev server port.') }),
      })
        .server(async ({ port }) => preview(port ? { port } : {}))
        .modelOutput(r => r.url) as unknown as AnyTool,
    )
  }

  return tools
}
