import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  builtinDomainPresets,
  cloudflareTarget,
  dokployTarget,
  selectPreset,
  type DeployTarget,
  type DomainPreset,
  type FrameworkSignals,
} from '@gemstack/ai-autopilot'
import { type ClaudeCodeDriverOptions, type Driver, type DriverSession, type McpServerSpec, type PermissionMode } from './driver/index.js'
import { AGENTS, AGENT_SPECS, createDriver, isAgentName, type AgentName } from './agent.js'
import { launchSharedBrowser, type SharedBrowser } from './browser.js'
import { connectCdp, startBrowserStream, type BrowserStream } from './browser-stream.js'
import { hostExecutor } from './host-exec.js'
import { startDashboard, singleProjectProvider, resolveDashboardBundle, type Dashboard } from './dashboard/index.js'
import { startRelay, relayPublisher, type RelayPublisher } from './relay.js'
import { randomUUID } from 'node:crypto'
import { formatFrameworkEvent } from './terminal.js'
import { CLAUDE_CODE_SESSION_LINK } from './session-link.js'
import { type ChoicePick, type ChoiceRequest, type FrameworkEvent } from './events.js'
import {
  runFramework,
  type AppPreview,
  type DeployDecision,
  type RunFrameworkOptions,
  type RunFrameworkResult,
  type ServeConfig,
} from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import { readProjectSignals } from './project.js'
import { loadFrameworkConfig, type FrameworkFileConfig } from './config.js'
import { type EcoOptions } from './system-prompt.js'
import { loadUserSystemPrompt, SYSTEM_PROMPT_FILE } from './system-prompt-file.js'
import { checkForUpdate, formatUpdateStatus, nodeVersionFetcher } from './update-check.js'
import { appendLog, type LogEntry } from './logs.js'
import { preflight } from './preflight.js'
import { RunStore, nodeStoreFs, renameRunBranch, runBranchName, type StoreFs } from './store/index.js'
import { materializePresets } from './presets.js'
import { daemonStatus, ensureDaemon, registerHomeProject, runDaemon, stopDaemon, DEFAULT_DAEMON_PORT } from './daemon.js'
import { resetControl, watchControl, type ControlWatcher } from './control.js'
import { RunMessageQueue } from './run-messages.js'
import { nodeGitRunner } from './project.js'
import { listProjects, readPreferences, resolveConsumptionLimits } from './registry.js'
import { startConsumptionGuard } from './consumption-guard.js'
import {
  planMaintenanceSweep,
  maintainSweep,
  writeMaintenanceState,
  short,
  type RepoReview,
} from './maintenance.js'
import { renderMaintainabilityPrompt } from './maintainability-preset.js'
import { renderOnBeforeMergeablePrompt, type OnBeforeMergeableContext } from './on-before-mergeable-prompt.js'
import { runPrompt } from './prompt-run.js'
import { renderResearchPrompt } from './research-preset.js'

/**
 * The default link shown for a live run: the generic Claude Code entry point,
 * surfaced as "Open Claude Code" (not a per-run live session). We drive Claude
 * Code headless, which is not Remote-Controlled, so there is no per-session deep
 * link to construct (#214). Pass `--session-link "...{sessionId}..."` if you
 * wire up a real one.
 */
export const CLAUDE_CODE_SESSION_LIST = CLAUDE_CODE_SESSION_LINK

/**
 * The session link to show for a run: the user's `--session-link` if given, else
 * the generic Claude Code entry point for a live run (nothing for `--fake`, which
 * has no real session). Pure, so the default is unit-testable without a live run.
 *
 * The default is Claude Code's *own* entry point, so it is only honest on a
 * Claude run: pointing a Codex session at claude.ai/code offers the user a link
 * to somewhere their run isn't. Codex keeps its sessions locally with nothing
 * equivalent to open, so another agent gets no default link at all (#542).
 */
export function chooseSessionLink(opts: Pick<CliOptions, 'sessionLink' | 'agent'>, fake: boolean): string | undefined {
  if (opts.sessionLink) return opts.sessionLink
  return fake || opts.agent !== 'claude' ? undefined : CLAUDE_CODE_SESSION_LIST
}

/** Where the CLI writes. Injectable so tests capture output. */
export interface CliIO {
  out: (line: string) => void
  err: (line: string) => void
}

const defaultIO: CliIO = {
  out: line => process.stdout.write(line + '\n'),
  err: line => process.stderr.write(line + '\n'),
}

/**
 * The CLI version, read from the package's own `package.json` at runtime (#312).
 * The compiled entry lives one level under the package root (`dist/` or
 * `dist-test/`), so its `package.json` is always `../package.json`. Cached after
 * the first read; falls back to `0.0.0` if the file is somehow unreadable.
 */
let cachedVersion: string | undefined
export function frameworkVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    cachedVersion = pkg.version ?? '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

const HELP = `The Framework — turnkey AI orchestration that wraps a coding agent (Claude Code or Codex).

Usage:
  framework                       Run the dashboard in the foreground (Ctrl+C stops it; logs visible).
  framework --daemon              Run the dashboard in the background; print commands and return.
  framework [intent...]           Build what you describe, from scratch.
  framework stop                  Stop the background dashboard for this workspace.
  framework research [what]      Rate the "problem variability" of <what> (default:
                                 this PR), then pick which problems to deep-dive.
                                 A direct review prompt on existing code — no build.
  framework prompt <text>         Run one prompt verbatim through the agent, honoring
                                 its await gates — no scaffold/build pipeline. This is
                                 what a dashboard preset sends after you edit it.
  framework maintain              Sweep the registered repos: run the maintainability
                                 loop on any that grew un-reviewed commits (#298).
                                 --dry-run to preview; --max-repos / --max-cost to bound.
  framework --fake                Run the offline demo (no CLI, no model, deterministic).
  framework doctor                Check prerequisites (Claude Code installed, etc.).
  framework relay                 Host a session relay so teammates can watch a session (#230).

Options:
  --fake                 Use the fake driver + scripted session (offline / CI).
  --agent <claude|codex> Which agent CLI drives the session, on your own subscription
                         (default: claude). Codex reports no price and no quota,
                         so --max-cost and the consumption limits cannot gate it;
                         the session says so at startup rather than imply a guard.
  --cwd <dir>            Workspace the agent builds in (default: current directory).
  --model <id>           Model to pass through to the wrapped agent.
  --scope <prototype|full>   How much app to build (default: full).
  --preset <name>        Run under an Open Loop domain preset (its loops + prompts
                         + skills frame the build), e.g. software-development.
  --autopilot            Activate the preset's Autopilot mode variants.
  --technical            Activate the preset's Technical mode variants.
                         (--preset / --autopilot / --technical / --kind can also be
                          set per repo in the-framework.yml; these flags override it.)
  --vanilla              Remove the built-in system prompt entirely. The agent still
                         gets the AWAIT/SIGNAL emit contract, so it can drive the
                         dashboard's gates; for a fully raw session use --transparent.
                         Overrides the Eco flags below (no built-in prompt to trim).
  --transparent          Fully transparent (#625): run the wrapped agent raw, exactly
                         like plain "claude -p" — no framework system prompt, emit
                         protocols, consumption guard, dashboard, or TODO loop. The
                         coarse master off-switch; also settable per repo in
                         the-framework.yml (transparent: true) or per user.
  --eco-auto-planning    Drop the built-in prompt's "Large scope" (planning) section.
  --eco-auto-research    Drop the built-in prompt's "Alternatives" (research) section.
  --eco-auto-maintenance Drop the "Maintenance" section from the post-merge
                         cleanup prompt. Needs --on-before-mergeable; #556 moved
                         that section out of the built-in prompt.
                         (The --eco-* flags trim the #326 prompt to save tokens.)
  --context <dir>        Focus the agent on this directory (repeatable). Adds one
                         "Context: <dirs>" line to the system prompt; the agent can
                         still reach every repo, this just narrows where it looks.
  --on-before-mergeable           When the run signals setReadyForMerge(), fire the on-before-mergeable
                         prompt: queue the maintainability and security-audit follow-ups
                         (plus readability under --technical) as TODO entries for the
                         backlog loop to pick up (#326).
  --browser              Give the agent a real browser during the run via
                         chrome-devtools-mcp: navigate pages, read console + network,
                         inspect the DOM, and screenshot. Off by default (#452).
  --kind <name>          Build event kind the preset's review loop fires for, e.g.
                         bug-fix or major-change (default: the-framework.yml's event,
                         else the preset's own, else major-change). Selects which
                         review chain gates the session.
  --max-passes <n>       Full-fledged loop pass budget (default: 5).
  --max-cost <usd>       Stop the session once it has spent this much (USD).
  --no-todo-loop         Do not consume the agent's TODO backlog after the build
                         (the loop is on by default; it gates per item on the
                         dashboard and stops when the backlog is empty).
  --max-todo-items <n>   Backlog entries worked per session (default: 25).
  --permission-mode <mode>   Claude Code permission mode: default | acceptEdits |
                             bypassPermissions | plan (default: bypassPermissions,
                             so the headless loop can run installs/builds/tests).
  --dangerously-skip-permissions   Bypass all agent permission checks (sandboxes only).
  --serve <cmd>          Gate the loop on the app actually running (e.g. "npm run dev"),
                         then keep it serving with a preview link on the dashboard.
  --serve-install <cmd>  Install command before serving (e.g. "npm install").
  --serve-build <cmd>    Build command before serving (e.g. "npm run build").
  --serve-port <n>       Port the app listens on (default: 3000).
  --serve-path <path>    Path to health-check once it is up (default: /).
  --sandbox <where>      Where --serve runs: "local" (host, default) or "docker"
                         (a throwaway container, so agent code never runs on the host).
  --deploy <target>      Deploy to this target (cloudflare, dokploy) or narrate any other.
  --cf-project <name>    Cloudflare Pages project name (for a Pages deploy).
  --dokploy-url <url>    Dokploy instance URL (required for --deploy dokploy).
  --dokploy-app <id>     Dokploy application id (required for --deploy dokploy).
  --port <n>             Dashboard port (default: 4200); with the relay, the relay port (4488).
  --no-dashboard         Do not start the localhost dashboard.
  --share <relay-url>    Publish this session to a relay (from "framework relay") so
                         teammates can watch it live; prints the shareable URL.
  --resume               Reopen the last session's dashboard from .the-framework/ in --cwd
                         (read-only replay; no new agent session). Survives a restart.
  --no-persist           Do not write the orchestration state to .the-framework/.
  --skip-preflight       Skip the prerequisite checks before a live session.
  --session-link <url>   A real per-session link to the live agent session, shown
                         on the dashboard. Our sessions are headless (not Remote-
                         Controlled), so by default the dashboard only offers the
                         generic "Open Claude Code" entry point. Pass your own URL,
                         using {sessionId} to template in the real Claude session
                         id, e.g. "https://example.com/s/{sessionId}".
  -h, --help             Show this help.
  -v, --version          Print the version.

The Framework drives the wrapped agent as a black box: it prompts, reads the code,
and gates on the outcome (builds / serves / review-passes), then re-prompts. The
localhost dashboard foregrounds the loop status beside the agent's own session.`

/** Parsed CLI options. */
export interface CliOptions {
  help: boolean
  version: boolean
  fake: boolean
  doctor: boolean
  skipPreflight: boolean
  intent: string
  /** `--agent <claude|codex>`: which agent CLI drives the run (#542). Default `claude`. */
  agent: AgentName
  cwd?: string | undefined
  /**
   * `--run-id <id>` (#736): the id the daemon allocated for this run before spawning it. Its
   * presence says the framework owns this run's checkout — `--cwd` is a worktree the daemon
   * created on a `the-framework/run-<id>` branch, which the run renames once the agent names
   * the session. Absent for a plain `framework "..."`, which runs in the user's own checkout.
   */
  runId?: string | undefined
  /**
   * `--continue-run` (#762): this run continues the run `--run-id` names rather than starting a new
   * one. The store reopens that run's log instead of truncating it, so messaging a stopped run
   * stays one row in the history.
   */
  continueRun?: boolean | undefined
  model?: string | undefined
  /** `--resume-session <id>` (#720): continue a finished run's agent session — the prompt resumes that conversation (full prior context). Set by the dashboard when you message a run that has ended. */
  resumeSession?: string | undefined
  scope: 'prototype' | 'full'
  preset?: string | undefined
  autopilot: boolean
  technical: boolean
  /** `--vanilla`: remove the built-in #326 system prompt entirely (antiLazyPill off, #314). */
  vanilla: boolean
  /** `--transparent` (#625): run the wrapped agent fully raw — no framework system prompt, emit
   * protocols, consumption guard, dashboard, or TODO loop, so a run is identical to `claude -p`. */
  transparent: boolean
  /** `--eco-*`: fine-grained #326 section drops to save tokens (#314). */
  eco: Required<EcoOptions>
  /** `--context <dir>` (repeatable): in-context directories added as one `Context:` line (#439). */
  context: string[]
  /** `--on-before-mergeable`: fire the #326 on-before-mergeable prompt when the run signals setReadyForMerge(), queueing the quality follow-ups as TODO entries. */
  onBeforeMergeable: boolean
  /** `--browser`: give the agent a real browser via chrome-devtools-mcp (navigate, console, network, DOM, screenshot) during the run (#452). */
  browser: boolean
  buildEvent?: string | undefined
  maxPasses?: number
  maxCost?: number
  todoLoop: boolean
  todoMaxItems?: number
  deploy?: string | undefined
  cfProject?: string | undefined
  dokployUrl?: string | undefined
  dokployApp?: string | undefined
  serve?: string | undefined
  serveInstall?: string | undefined
  serveBuild?: string | undefined
  servePort?: number
  servePath?: string | undefined
  sandbox?: 'local' | 'docker' | undefined
  port?: number
  dashboard: boolean
  relayServe: boolean
  share?: string | undefined
  sessionLink?: string | undefined
  permissionMode?: PermissionMode | undefined
  skipPermissions: boolean
  resume: boolean
  persist: boolean
  /** `framework --daemon`: run the dashboard in the background (detached), then return (#456). */
  daemon: boolean
  /** Serve the dashboard in-process — the detached child's entry, spawned by the background path (internal, #456). */
  daemonServe: boolean
  /** `framework stop`: stop the background daemon for this workspace. */
  stop: boolean
  /** `framework research [what]`: run the Research preset as a direct prompt (#331). */
  research: boolean
  /** `framework prompt <text>`: run one prompt verbatim through the direct path (#353). */
  directPrompt: boolean
  /** `framework maintain`: sweep the registered repos, running the maintenance loop on un-reviewed commits (#298). */
  maintain: boolean
  /** `--dry-run`: for `maintain`, list what would be reviewed without running anything. */
  dryRun: boolean
  /** `--max-repos <n>`: cap how many repos one maintenance sweep reviews. */
  maxRepos?: number
  error?: string
}

/** Parse argv (without the node/script prefix). Pure and testable. */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    help: false,
    version: false,
    fake: false,
    doctor: false,
    skipPreflight: false,
    intent: '',
    agent: 'claude',
    scope: 'full',
    autopilot: false,
    technical: false,
    vanilla: false,
    transparent: false,
    eco: { autoPlanning: false, autoResearch: false, autoMaintenance: false },
    context: [],
    onBeforeMergeable: false,
    browser: false,
    dashboard: true,
    relayServe: false,
    skipPermissions: false,
    resume: false,
    persist: true,
    daemon: false,
    daemonServe: false,
    stop: false,
    research: false,
    directPrompt: false,
    maintain: false,
    dryRun: false,
    todoLoop: true,
  }
  const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan']
  const words: string[] = []
  // Parse an integer flag's value, recording opts.error (naming the flag) on a bad one. The
  // integer flags all share this shape; only the lower bound (0 for --port, else 1) varies.
  const intFlag = (value: string | undefined, label: string, min: number): number | undefined => {
    const n = Number(value)
    if (Number.isInteger(n) && n >= min) return n
    opts.error = `invalid ${label}: must be a ${min > 0 ? 'positive' : 'non-negative'} integer`
    return undefined
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true
        break
      case '-v':
      case '--version':
        opts.version = true
        break
      case '--fake':
        opts.fake = true
        break
      case '--no-dashboard':
        opts.dashboard = false
        break
      case '--preset':
        opts.preset = argv[++i]
        break
      case '--autopilot':
        opts.autopilot = true
        break
      case '--technical':
        opts.technical = true
        break
      case '--vanilla':
        opts.vanilla = true
        break
      case '--transparent':
        opts.transparent = true
        break
      case '--on-before-mergeable':
        opts.onBeforeMergeable = true
        break
      case '--browser':
        opts.browser = true
        break
      case '--eco-auto-planning':
        opts.eco.autoPlanning = true
        break
      case '--eco-auto-research':
        opts.eco.autoResearch = true
        break
      case '--eco-auto-maintenance':
        opts.eco.autoMaintenance = true
        break
      case '--context': {
        // Repeatable: `--context a --context b` -> the in-context directories (#439).
        const dir = argv[++i]
        if (dir) opts.context.push(dir)
        break
      }
      case '--kind':
        opts.buildEvent = argv[++i]
        break
      case '--resume':
        opts.resume = true
        break
      case '--daemon':
        opts.daemon = true
        break
      case '--daemon-serve':
        opts.daemonServe = true
        break
      case '--no-persist':
        opts.persist = false
        break
      case '--skip-preflight':
        opts.skipPreflight = true
        break
      case '--dangerously-skip-permissions':
        opts.skipPermissions = true
        break
      case '--permission-mode': {
        const value = argv[++i] as PermissionMode | undefined
        if (value === undefined || !PERMISSION_MODES.includes(value)) {
          opts.error = `invalid --permission-mode: ${value ?? '(missing)'}`
        } else {
          opts.permissionMode = value
        }
        break
      }
      case '--agent': {
        const value = argv[++i]
        if (!isAgentName(value)) opts.error = `invalid --agent: ${value ?? '(missing)'}. Expected: ${AGENTS.join(' | ')}`
        else opts.agent = value
        break
      }
      case '--cwd':
        opts.cwd = argv[++i]
        break
      case '--run-id':
        opts.runId = argv[++i]
        break
      case '--continue-run':
        opts.continueRun = true
        break
      case '--model':
        opts.model = argv[++i]
        break
      case '--resume-session':
        opts.resumeSession = argv[++i]
        break
      case '--deploy':
        opts.deploy = argv[++i]
        break
      case '--cf-project':
        opts.cfProject = argv[++i]
        break
      case '--dokploy-url':
        opts.dokployUrl = argv[++i]
        break
      case '--dokploy-app':
        opts.dokployApp = argv[++i]
        break
      case '--serve':
        opts.serve = argv[++i]
        break
      case '--serve-install':
        opts.serveInstall = argv[++i]
        break
      case '--serve-build':
        opts.serveBuild = argv[++i]
        break
      case '--serve-path':
        opts.servePath = argv[++i]
        break
      case '--serve-port': {
        const n = intFlag(argv[++i], '--serve-port', 1)
        if (n !== undefined) opts.servePort = n
        break
      }
      case '--sandbox': {
        const where = argv[++i]
        if (where !== 'local' && where !== 'docker') opts.error = `invalid --sandbox: expected "local" or "docker"`
        else opts.sandbox = where
        break
      }
      case '--share':
        opts.share = argv[++i]
        break
      case '--session-link':
        opts.sessionLink = argv[++i]
        break
      case '--scope': {
        const value = argv[++i]
        if (value !== 'prototype' && value !== 'full') opts.error = `invalid --scope: ${value ?? '(missing)'}`
        else opts.scope = value
        break
      }
      case '--max-passes': {
        const n = intFlag(argv[++i], '--max-passes', 1)
        if (n !== undefined) opts.maxPasses = n
        break
      }
      case '--max-cost': {
        const n = Number(argv[++i])
        if (!Number.isFinite(n) || n <= 0) opts.error = `invalid --max-cost: must be a positive number (USD)`
        else opts.maxCost = n
        break
      }
      case '--no-todo-loop':
        opts.todoLoop = false
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--max-repos': {
        const n = intFlag(argv[++i], '--max-repos', 1)
        if (n !== undefined) opts.maxRepos = n
        break
      }
      case '--max-todo-items': {
        const n = intFlag(argv[++i], '--max-todo-items', 1)
        if (n !== undefined) opts.todoMaxItems = n
        break
      }
      case '--port': {
        const n = intFlag(argv[++i], '--port', 0)
        if (n !== undefined) opts.port = n
        break
      }
      default:
        if (arg.startsWith('-')) opts.error = `unknown option: ${arg}`
        else words.push(arg)
    }
  }
  // `framework doctor` / `framework relay` / `framework stop` are subcommands, not an intent.
  if (words[0] === 'doctor') {
    opts.doctor = true
    words.shift()
  } else if (words[0] === 'relay') {
    opts.relayServe = true
    words.shift()
  } else if (words[0] === 'stop') {
    opts.stop = true
    words.shift()
  } else if (words[0] === 'research') {
    opts.research = true
    words.shift() // the remaining words are the "what" param (may be empty -> default)
  } else if (words[0] === 'prompt') {
    opts.directPrompt = true
    words.shift() // the remaining words are the prompt text, run verbatim (#353)
  } else if (words[0] === 'maintain') {
    opts.maintain = true
    words.shift() // maintain takes no positional args; the target is the registry
  }
  opts.intent = words.join(' ').trim()
  return opts
}

/**
 * Resolve the Claude Code driver options for a live CLI run. The CLI is a
 * headless autonomous builder: every turn is `claude -p`, which cannot answer an
 * interactive approval. The driver's library default (`acceptEdits`) silently
 * denies installs/builds/tests, so the production-grade checklist can never
 * verify the app actually builds/runs (#225). Default the CLI to
 * `bypassPermissions` so the full loop runs unattended; `--permission-mode` and
 * `--dangerously-skip-permissions` still override.
 */
export function claudeDriverOptions(opts: Pick<CliOptions, 'permissionMode' | 'skipPermissions'>): ClaudeCodeDriverOptions {
  return opts.skipPermissions
    ? { dangerouslySkipPermissions: true }
    : { permissionMode: opts.permissionMode ?? 'bypassPermissions' }
}

/**
 * The `--browser` MCP wiring (#452): chrome-devtools-mcp is a maintained stdio
 * server that launches its own Chromium and exposes DevTools tools (navigate,
 * console, network, DOM, screenshot). `npx -y` resolves it on demand so there is
 * nothing to pre-install. Merged into the build driver only, not the short
 * preset-router turn.
 */
export const BROWSER_MCP_SERVERS: Record<string, McpServerSpec> = {
  'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
}

/**
 * The same server, pointed at a Chrome the run already launched (#793). `--browserUrl` makes
 * it attach instead of launching, which is what lets a second client (the #609 screencast)
 * watch the very page the agent is on. Without a URL this is the old spec unchanged.
 */
export function browserMcpServers(browserUrl?: string | undefined): Record<string, McpServerSpec> {
  if (!browserUrl) return BROWSER_MCP_SERVERS
  return { 'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', browserUrl] } }
}

/** Fold the `--browser` MCP server into driver options when the flag is set. */
export function withBrowser(
  base: ClaudeCodeDriverOptions,
  browser: boolean,
  browserUrl?: string | undefined,
): ClaudeCodeDriverOptions {
  if (!browser) return base
  return { ...base, mcpServers: { ...base.mcpServers, ...browserMcpServers(browserUrl) } }
}

/**
 * The flags the picked agent cannot honor (#542), as lines to print at startup.
 *
 * A flag that silently does nothing is worse than one that errors. `--agent
 * codex --max-cost 5` reads as capped and isn't: the cap is only ever checked on
 * a turn that reports a price, and Codex reports none (#540). The consumption
 * limits go the same way — no quota to read means no gate. So the run says which
 * guards are not in force, rather than letting the flag imply they are.
 */
export function unguardedNotices(
  opts: Pick<CliOptions, 'agent' | 'maxCost' | 'browser' | 'permissionMode' | 'skipPermissions'>,
): string[] {
  const spec = AGENT_SPECS[opts.agent]
  const notices: string[] = []
  if (opts.maxCost != null && !spec.reportsCost) {
    notices.push(`--max-cost $${opts.maxCost} cannot be enforced: ${spec.label} reports no price per turn, so the spend cap never fires (#540).`)
  }
  if (opts.agent !== 'claude') {
    if (opts.browser) {
      notices.push(`--browser has no effect on ${spec.label}: the browser tools are wired through Claude Code's MCP config.`)
    }
    if (opts.permissionMode !== undefined || opts.skipPermissions) {
      notices.push(`--permission-mode / --dangerously-skip-permissions have no effect on ${spec.label}: it sandboxes with its own policy (workspace-write).`)
    }
  }
  return notices
}

/** The active Open Loop modes from the mode flags, in a stable order. */
export function activeModes(opts: Pick<CliOptions, 'autopilot' | 'technical'>): string[] {
  const modes: string[] = []
  if (opts.autopilot) modes.push('autopilot')
  if (opts.technical) modes.push('technical')
  return modes
}

/**
 * Whether the built-in #326 system prompt is removed for this run (#314): the
 * Vanilla toggle (`--vanilla`) or `the-framework.yml`'s `antiLazyPill: false`.
 */
export function antiLazyPillOff(opts: Pick<CliOptions, 'vanilla'>, file: FrameworkFileConfig): boolean {
  return opts.vanilla || file.antiLazyPill === false
}

/** The Eco section drops in effect (#314), or `undefined` when none are set. */
export function ecoOptions(opts: Pick<CliOptions, 'eco'>): EcoOptions | undefined {
  const { autoPlanning, autoResearch, autoMaintenance } = opts.eco
  if (!autoPlanning && !autoResearch && !autoMaintenance) return undefined
  return { autoPlanning, autoResearch, autoMaintenance }
}

/** The log kind a run records in `.the-framework/LOGS.md` (#379): the direct paths are prompts, a
 * build run is a build. Transparent (#625) routes a build-kind run through the raw prompt path too,
 * so it logs as a prompt. */
export function runLogKind(opts: Pick<CliOptions, 'directPrompt' | 'research'>, transparent = false): LogEntry['kind'] {
  return opts.directPrompt || opts.research || transparent ? 'prompt' : 'build'
}

/**
 * Build the project-log entry (#379) for a finished run from its `end` event and
 * the session captured along the way. Pure, so the status mapping is unit-testable
 * without a live run.
 */
export function runLogEntry(input: {
  at: string
  kind: LogEntry['kind']
  title: string
  end: Extract<FrameworkEvent, { kind: 'end' }>
  sessionId?: string | undefined
  sessionLink?: string | undefined
}): LogEntry {
  const status: LogEntry['status'] = input.end.ok ? 'done' : input.end.stopped ? 'stopped' : 'failed'
  return {
    at: input.at,
    kind: input.kind,
    title: input.title,
    status,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.sessionLink ? { sessionLink: input.sessionLink } : {}),
  }
}

/**
 * Merge CLI flags over a project's `the-framework.yml` defaults (#258). A `--preset`
 * flag wins over the file's `preset`; the mode flags OR with the file's booleans
 * (a flag can only *enable* a mode, so there is nothing to override the other way).
 */
export function mergeRunConfig(
  opts: Pick<CliOptions, 'preset' | 'autopilot' | 'technical' | 'buildEvent'>,
  file: FrameworkFileConfig,
): { presetName?: string; autopilot: boolean; technical: boolean; buildEvent?: string } {
  const presetName = opts.preset ?? file.preset
  const buildEvent = opts.buildEvent ?? file.event
  return {
    ...(presetName ? { presetName } : {}),
    ...(buildEvent ? { buildEvent } : {}),
    autopilot: opts.autopilot || file.autopilot === true,
    technical: opts.technical || file.technical === true,
  }
}

/** A short summary of what the-framework.yml contributed and is in effect, or `''` for nothing to report. */
function describeConfigSource(opts: Pick<CliOptions, 'preset' | 'buildEvent'>, file: FrameworkFileConfig): string {
  const parts: string[] = []
  if (file.preset && !opts.preset) parts.push(`preset=${file.preset}`) // a --preset flag would override it
  if (file.autopilot) parts.push('autopilot')
  if (file.technical) parts.push('technical')
  if (file.event && !opts.buildEvent) parts.push(`event=${file.event}`) // a --kind flag would override it
  return parts.join(', ')
}

/**
 * Resolve `--preset <name>` to a shipped {@link DomainPreset}, loaded with the
 * active `modes` so its conditions variants are selected (#254, #256). Returns
 * nothing when no `--preset` was given; an error (with the available names) when
 * the name does not match a built-in.
 */
export async function resolveDomainPreset(
  name: string | undefined,
  modes: readonly string[],
): Promise<{ preset?: DomainPreset; error?: string }> {
  if (!name) return {}
  const presets = await builtinDomainPresets({ modes })
  const preset = selectPreset(presets, name)
  if (!preset) {
    const available = presets.map(p => p.name).join(', ') || '(none shipped)'
    return { error: `unknown --preset: ${name}. Available: ${available}` }
  }
  return { preset }
}

/** The run-scoped state {@link settleRun} needs to close out either run path. */
interface RunEpilogue {
  io: CliIO
  dashboard: Dashboard | undefined
  store: RunStore | undefined
  control: ControlWatcher | undefined
  guard: { stop: () => void } | undefined
  publisher: RelayPublisher | undefined
  /** The run's Chrome (#793), stopped with the run so no headless browser outlives it. */
  sharedBrowser: SharedBrowser | undefined
  /** The preview of that browser (#802), stopped with the run. */
  browserStream: BrowserStream | undefined
  clearInterrupt: () => void
  maybeFireOnBeforeMergeable: () => Promise<void>
  /** True once the run stopped cleanly (interrupt / budget cap) rather than failed. */
  isStopped: () => boolean
  /** How a real failure is labelled: "run", "research", or "prompt run". */
  failLabel: string
}

/**
 * Run one engine (a build or a direct prompt) and settle it identically: on success print its
 * line and keep the dashboard (and any app preview) up until Ctrl+C; on a clean stop (interrupt
 * / budget cap #322) report it and stay up; on a real failure report it and close. The teardown
 * — flush the store, close the control channel + consumption guard, flush the relay — runs
 * either way. Returns the exit code (0 on success or a clean stop, 1 on a failure). Shared by
 * both run paths so their epilogues cannot drift.
 */
async function settleRun(
  ctx: RunEpilogue,
  run: () => Promise<{ successLine: string; preview?: AppPreview }>,
): Promise<number> {
  const { io, dashboard } = ctx
  try {
    const { successLine, preview } = await run()
    // Run settled: hand Ctrl+C back to the post-run dashboard/app wait below.
    ctx.clearInterrupt()
    io.out(successLine)
    if (preview) io.out(`\n▶ Your app is running at ${preview.url} — open it in a browser.`)
    await ctx.store?.close() // flush the event log; best-effort
    await ctx.maybeFireOnBeforeMergeable()
    // Stay up while the dashboard and/or the app are live, then tear both down.
    if (dashboard || preview) {
      if (dashboard) io.out(`\nDashboard still live at ${dashboard.url}. Press Ctrl+C to exit.`)
      else io.out(`\nPress Ctrl+C to stop the app.`)
      await waitForInterrupt()
      if (preview) await preview.stop()
      await dashboard?.close()
    }
    return 0
  } catch (err) {
    ctx.clearInterrupt()
    await ctx.store?.close()
    // A clean stop (Stop button, Ctrl+C, or a budget cap #322) is not a failure: report it,
    // keep the dashboard up so the stopped state stays visible, and exit 0.
    if (ctx.isStopped()) {
      io.out('\n■ Stopped.')
      if (dashboard) await keepDashboardUp(dashboard, io)
      return 0
    }
    io.err(`\n✗ ${ctx.failLabel} failed: ${err instanceof Error ? err.message : String(err)}`)
    await dashboard?.close()
    return 1
  } finally {
    ctx.clearInterrupt()
    ctx.control?.close()
    ctx.guard?.stop()
    await ctx.browserStream?.close()
    await ctx.sharedBrowser?.close()
    // Make sure every event (including the final `end`) reached the relay before exit.
    if (ctx.publisher) await ctx.publisher.flush()
  }
}

/**
 * Start this run's single-project dashboard on `cwd` (#427), or return undefined to run
 * headless. `enabled` gates it (a --no-persist run has no event log to stream); a missing
 * bundle (an old install) or a startup error also fall back to headless. `resumed` tags the
 * URL line, and `headlessNote` is the fallback message's tail.
 */
async function startRunDashboard(
  enabled: boolean,
  cwd: string,
  port: number | undefined,
  io: CliIO,
  labels: { resumed?: boolean; headlessNote: string },
): Promise<Dashboard | undefined> {
  if (!enabled) return undefined
  const clientBundleDir = await resolveDashboardBundle()
  if (!clientBundleDir) return undefined
  try {
    const dashboard = await startDashboard({
      ...(port !== undefined ? { port } : {}),
      clientBundleDir,
      projects: singleProjectProvider(cwd),
    })
    io.out(`◆ dashboard${labels.resumed ? ' (resumed)' : ''}: ${dashboard.url}`)
    return dashboard
  } catch (err) {
    io.err(`could not start dashboard (${err instanceof Error ? err.message : String(err)}); ${labels.headlessNote}`)
    return undefined
  }
}

/**
 * Resolve the system-prompt configuration both run paths share (#301/#314), echoing what
 * is in effect: a user SYSTEM.md, the built-in prompt toggle, the eco section drops, and the
 * in-context dirs. Reads SYSTEM.md once, so call it on the shared path before either run.
 */
async function resolvePromptConfig(
  opts: CliOptions,
  fileConfig: FrameworkFileConfig,
  cwd: string,
  io: CliIO,
  transparent: boolean,
): Promise<{ userSystemPrompt?: string; noBuiltinPrompt: boolean; eco?: EcoOptions }> {
  const userSystemPrompt = await loadUserSystemPrompt(cwd)
  // Transparent empties the whole channel, which subsumes "no built-in prompt".
  const noBuiltinPrompt = transparent || antiLazyPillOff(opts, fileConfig)
  const eco = ecoOptions(opts)
  if (userSystemPrompt) io.out(`◆ system prompt: ${SYSTEM_PROMPT_FILE}`)
  // Transparent already announced itself (guard line); don't double-report the prompt being off.
  if (noBuiltinPrompt && !transparent) io.out(`◆ built-in system prompt: off (${opts.vanilla ? 'vanilla' : 'the-framework.yml'})`)
  else if (eco) io.out(`◆ eco: dropping ${Object.keys(eco).filter(k => eco[k as keyof EcoOptions]).join(', ')}`)
  if (opts.context.length) io.out(`◆ context: ${opts.context.join(', ')}`)
  return { ...(userSystemPrompt ? { userSystemPrompt } : {}), noBuiltinPrompt, ...(eco ? { eco } : {}) }
}

/**
 * The `framework` command. Wires the parsed options into {@link runFramework}
 * over a live dashboard + terminal narration, and resolves with an exit code.
 * Returns 0 on success, 1 on a run error, 2 on a usage error.
 */
export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const opts = parseArgs(argv)
  if (opts.error) {
    io.err(opts.error)
    io.err('Run `framework --help` for usage.')
    return 2
  }
  if (opts.help) {
    io.out(HELP)
    return 0
  }
  if (opts.version) {
    io.out(frameworkVersion())
    return 0
  }
  if (opts.doctor) {
    const result = await preflight({ agent: opts.agent })
    for (const check of result.checks) io.out(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`)
    io.out(result.ok ? '\nAll good. You are ready to build.' : '\nSome checks failed. Fix them, then try again.')
    return result.ok ? 0 : 1
  }

  // `framework relay` hosts the run relay: teammates open a run's URL and watch it
  // live (#230). It runs until interrupted; a run publishes to it with `--share`.
  if (opts.relayServe) return runRelayServer(opts, io)

  // Resume a previous run's dashboard from its persisted log — the reload half of
  // #211. No agent runs; we just replay the saved events into a fresh stream so
  // the dashboard rehydrates exactly as it looked, then leave it up read-only.
  if (opts.resume) return resumeRun(opts, io)

  // `--daemon-serve` is the detached child's own entry: it *is* the persistent dashboard,
  // serving until signalled. Internal — the background `--daemon` path spawns it (#456).
  if (opts.daemonServe) {
    await runDaemon(opts.cwd ?? process.cwd(), opts.port !== undefined ? { port: opts.port } : {})
    return 0
  }

  // `framework --daemon` runs the dashboard in the background (detached) and returns, printing
  // the convenience commands (#456). Bare `framework` foregrounds it instead (below).
  if (opts.daemon) return ensureDaemonCmd(opts, io)

  // `framework stop` stops this workspace's background dashboard.
  if (opts.stop) return stopDaemonCmd(opts, io)

  // `framework maintain` sweeps the registered repos, running the maintenance loop on
  // any that grew un-reviewed commits (#298). No dashboard, no intent.
  if (opts.maintain) return maintainCmd(opts, io)

  const fake = opts.fake
  const intent = opts.intent || (fake ? FAKE_INTENT : '')
  // Bare `framework` (no prompt): run the dashboard server in the foreground so its logs
  // (and server-thrown errors) are visible, and Ctrl+C stops it (#456). A prompt still
  // builds. A bare `framework prompt` has nothing to run — verbatim text is required.
  if (opts.directPrompt && !intent) {
    io.err('framework prompt needs the prompt text, e.g. `framework prompt "review the auth flow"`.')
    io.err('Run `framework --help` for usage.')
    return 2
  }
  // A bare `framework research` is a real run — its "what" defaults to `this PR`.
  if (!intent && !fake && !opts.research) return runForegroundDaemonCmd(opts, io)

  const cwd = opts.cwd ?? (fake ? join(tmpdir(), 'framework-fake-workspace') : process.cwd())

  // The project can carry its own Open Loop defaults in the-framework.yml (#258):
  // which domain preset + modes to build under. CLI flags override the file; a bad
  // file is a warning, never a failed run. Read from the run's own workspace, so a
  // --fake demo (empty tmp cwd) stays deterministic unless pointed at a config dir.
  const fileConfig = await loadFrameworkConfig(cwd, msg => io.err(msg))
  const fromFile = describeConfigSource(opts, fileConfig)
  if (fromFile) io.out(`◆ the-framework.yml: ${fromFile}`)

  // Transparent mode (#625): the coarse master off-switch — `--transparent` or the-framework.yml.
  // When on, this run is byte-identical to raw `claude -p`: no framework system channel (composed
  // empty below), no consumption guard, no dashboard, no TODO loop. Resolved once here so every
  // one of those sites reads the same answer.
  const transparent = opts.transparent || fileConfig.transparent === true

  // Only the direct-prompt path resumes a conversation (#782): a build run rebuilds the
  // scope/build framing a resumed transcript already carries, so it takes no session id and
  // used to drop the flag on the floor. Silently losing the context you asked to continue
  // from is the worst outcome, so say so and stop rather than run a fresh session that looks
  // like a resumed one.
  if (opts.resumeSession && !(opts.research || opts.directPrompt || transparent)) {
    io.err('--resume-session only applies to a prompt run, e.g. `framework prompt "keep going" --resume-session <id>`.')
    io.err('Run `framework --help` for usage.')
    return 2
  }

  // Resolve which Open Loop domain preset (+ modes + build event) to run under:
  // --preset / the-framework.yml, or none at all (#545). Nothing infers one.
  const merged = mergeRunConfig(opts, fileConfig)
  let presetName = merged.presetName
  let modeList = activeModes(merged)
  let buildEvent = merged.buildEvent
  let domainPreset: DomainPreset | undefined

  // An explicit --preset / the-framework.yml preset is validated up front — a bad
  // name is a usage error, independent of the environment, so it fails the same way
  // whether or not the agent is installed (before preflight).
  if (presetName) {
    const resolved = await resolveDomainPreset(presetName, modeList)
    if (resolved.error) {
      io.err(resolved.error)
      io.err('Run `framework --help` for usage.')
      return 2
    }
    domainPreset = resolved.preset
  }

  // Fail early and clearly if a live run's prerequisites are missing — before the
  // run, which needs the wrapped agent.
  if (!fake && !opts.skipPreflight) {
    const pre = await preflight({ agent: opts.agent })
    if (!pre.ok) {
      for (const check of pre.checks.filter(c => !c.ok)) io.err(`✗ ${check.name}: ${check.detail}`)
      io.err('Preflight failed. Fix the above, or pass --skip-preflight, or try `framework --fake`.')
      return 2
    }
  }

  // Which agent is about to spend the user's subscription, and which guards are
  // not in force while it does — said *before* the first turn. A cap that turns
  // out not to apply is worth knowing before the spending, not after (#542).
  if (!fake) {
    if (opts.agent !== 'claude') io.out(`◆ agent: ${AGENT_SPECS[opts.agent].label}`)
    for (const note of unguardedNotices(opts)) io.err(`note: ${note}`)
  }

  const claudeOpts = claudeDriverOptions(opts)
  // Detection signals: fixed for the fake demo, read from the project otherwise.
  // Computed once here, reused by extension discovery and the run.
  const signals = fake ? FAKE_SIGNALS : readProjectSignals(cwd)
  // One controller for the whole run: the dashboard Stop button aborts it once
  // wired below.
  const controller = new AbortController()

  // Ctrl+C / SIGTERM during a live run must abort the run — not let default
  // signal termination kill the framework while its spawned Claude Code tree
  // keeps running (the orphaned-process leak). Aborting drives the driver to
  // group-kill its child; a second signal force-quits. Removed once the run
  // settles so the post-run dashboard wait keeps its own Ctrl+C handling.
  let interrupts = 0
  const onInterrupt = () => {
    if (++interrupts === 1) {
      io.err('\n■ Interrupt: stopping the session (Ctrl+C again to force-quit)…')
      controller.abort()
    } else {
      process.exit(130)
    }
  }
  const clearInterrupt = () => {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onInterrupt)
  }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onInterrupt)

  // The dashboard Stop button aborts the run-wide controller created above.
  // runFramework checks the signal between phases and the driver kills its current
  // turn on it, so a stop takes effect promptly.
  //
  // Interactive choices (#304): the run's requestChoice handler parks a resolver
  // here keyed by the choice id; the dashboard's Accept / autopilot POSTs the pick
  // to /choice, which resolves it. Aborting the run resolves any pending choice
  // (proceed) so the gate never hangs a stopped run.
  const pendingChoices = new Map<string, (pick: ChoicePick) => void>()
  // Live-chat messages the user sends to the running run (#714). The control watcher
  // pushes each here; the run loop drains them between turns and waits here when idle.
  const messages = new RunMessageQueue()
  controller.signal.addEventListener('abort', () => {
    for (const resolve of pendingChoices.values()) resolve({ picked: 'proceed', by: 'auto' })
    pendingChoices.clear()
    messages.close()
  })
  // Serve the new Vike + Telefunc dashboard (#405/#427) for this run, in single-project mode:
  // the SPA reads this one `cwd`'s event/control logs without touching the global registry, so
  // a one-shot run never pollutes the Projects list. It streams the persisted event log, so a
  // --no-persist run (or an old install missing the built bundle) runs headless.
  const dashboard = await startRunDashboard(opts.dashboard && opts.persist && !transparent, cwd, opts.port, io, {
    headlessNote: 'continuing headless',
  })
  // The new dashboard steers this live run purely through control.jsonl (its Stop / choice
  // picks are Telefunc writes to that file, #427), which the watcher below tails whenever
  // the dashboard is up — not only when a daemon is.
  const newDashboard = dashboard !== undefined

  // Persist the orchestration state so a restart can --resume it (#211). The log
  // is the dashboard's own event stream, appended to .the-framework/ in the workspace.
  // Best-effort: a store that fails to open just means no persistence, never a
  // failed run. --no-persist opts out entirely.
  let store: RunStore | undefined
  if (opts.persist) {
    try {
      // Seed the run's intent (its prompt) so the dashboard's Runs list labels it instead of
      // showing "(no prompt)". A build run refines this via its scope event; a prompt/research
      // run keeps it. Research with no "what" defaults to the same "this PR" the log title uses.
      store = await RunStore.open(cwd, {
        fresh: true,
        intent: intent || (opts.research ? 'this PR' : ''),
        // Adopt the daemon's id (#736) so the run and the worktree it lives in share one.
        ...(opts.runId ? { id: opts.runId } : {}),
        // Continuing (#762): keep the existing log rather than starting this run's history over.
        ...(opts.continueRun ? { continueRun: true } : {}),
      })
    } catch (err) {
      io.err(`could not persist session state (${err instanceof Error ? err.message : String(err)}); continuing without it`)
    }
  }

  // Steer this run through .the-framework/control.jsonl (#344): a Stop button or choice
  // pick appends an entry, we tail the file and abort / resolve the parked gate. Reset
  // first so a previous run's picks can never fire into this one (gate ids repeat across
  // runs). Wired when the machine's daemon is live (#393, it steers any project's run) or
  // when this run's own new dashboard is up (#427, it too steers over control.jsonl).
  // Otherwise headless behavior is identical.
  let control: ControlWatcher | undefined
  if (opts.persist && (newDashboard || (await daemonStatus()))) {
    try {
      await resetControl(cwd)
      control = watchControl(cwd, entry => {
        if (entry.kind === 'stop') {
          controller.abort()
          return
        }
        if (entry.kind === 'message') {
          messages.push(entry.text)
          return
        }
        const resolve = pendingChoices.get(entry.id)
        if (resolve) {
          pendingChoices.delete(entry.id)
          resolve({ picked: entry.pick, by: entry.by })
        }
      })
    } catch (err) {
      io.err(`control channel unavailable (${err instanceof Error ? err.message : String(err)}); daemon steering disabled`)
    }
  }

  // Publish the run to a relay (#230) so teammates can watch it live. Best-effort:
  // a relay that is down reports each failed POST here but never fails the run.
  let publisher: RelayPublisher | undefined
  if (opts.share) {
    publisher = relayPublisher(opts.share, randomUUID(), err =>
      io.err(`relay publish failed (${err instanceof Error ? err.message : String(err)})`),
    )
    io.out(`◆ shared session: ${publisher.url}`)
  }

  // Pause the choice gates when someone can answer: this run's own dashboard, or the
  // workspace daemon's via the control channel (#344). With neither, the gates auto-accept
  // the recommended option (#304). The run's requestChoice parks a resolver in pendingChoices
  // keyed by the choice id; a dashboard/daemon pick (or an abort) resolves it.
  const requestChoice =
    dashboard || control
      ? (req: ChoiceRequest): Promise<ChoicePick> => new Promise(resolve => pendingChoices.set(req.id, resolve))
      : undefined
  // The session link shown on the dashboard: --session-link, else Claude Code's own entry for
  // a live Claude run, else nothing (#212/#542). Same for both run paths.
  const sessionLink = chooseSessionLink(opts, fake)

  // The framework's own verdict that the run stopped cleanly rather than failed —
  // set by a user interrupt or a budget cap (#322). Trusted over which signal
  // aborted, since a budget stop trips an internal signal the CLI never sees.
  let stoppedCleanly = false
  // The agent signalled setReadyForMerge() this run (#326): with --on-before-mergeable on, fire the
  // on-before-mergeable prompt once the run settles (not mid-run — it would race the agent's own git work).
  let sawReadyForMerge = false
  // The session the agent named via setSessionName() (#326). Carried on run state because the
  // on-before-mergeable prompt names it on every line: it is set before the first change and read here,
  // after the run.
  let sessionName: string | undefined
  // Record the finished run in the project log `.the-framework/LOGS.md` (#379). The
  // kind + title are known up front; the session id/link arrive mid-run, and the
  // `end` event (fired once by both run paths) closes the entry. Best-effort: the
  // project DB is committed history, so it must never break a run.
  const logKind = runLogKind(opts, transparent)
  const logTitle = intent || (opts.research ? 'this PR' : '')
  let logSessionId: string | undefined
  let logSessionLink: string | undefined
  // The browser preview's port, announced on the first `session` event rather than when the
  // bridge opens (#829). The dashboard renders only the tail from the last `session` event, so
  // anything emitted ahead of it is dropped from the run's view.
  let pendingBrowserPort: number | undefined
  const onEvent = (event: FrameworkEvent) => {
    if (event.kind === 'session' && event.sessionLink) logSessionLink = event.sessionLink
    else if (event.kind === 'session-update') {
      logSessionId = event.sessionId
      if (event.sessionLink) logSessionLink = event.sessionLink
    }
    if (event.kind === 'ready-for-merge') sawReadyForMerge = true
    if (event.kind === 'session-name') {
      sessionName = event.name
      // The framework-owned checkout (#736) was branched as `the-framework/run-<id>` before a
      // name existed; put the readable name on it now. No-ops when the agent branched itself.
      if (opts.runId) void renameRunBranch(cwd, runBranchName(opts.runId), `the-framework/${event.name}`)
    }
    if (event.kind === 'end') {
      if (event.stopped) stoppedCleanly = true
      const entry = runLogEntry({
        at: new Date().toISOString(),
        kind: logKind,
        title: logTitle,
        end: event,
        sessionId: logSessionId,
        sessionLink: logSessionLink,
      })
      void appendLog(cwd, entry).catch(() => {})
    }
    io.out(formatFrameworkEvent(event))
    void store?.append(event)
    publisher?.publish(event)

    // Right after the session opens, so it lands inside the slice the dashboard renders.
    if (event.kind === 'session' && pendingBrowserPort !== undefined) {
      const port = pendingBrowserPort
      pendingBrowserPort = undefined
      onEvent({ kind: 'browser-stream', port })
    }
  }

  // Fire the #326 on-before-mergeable prompt once a --on-before-mergeable run has settled and the agent
  // signalled setReadyForMerge(). Skipped for a fake/offline run and when the run was stopped.
  const maybeFireOnBeforeMergeable = async (): Promise<void> => {
    if (!opts.onBeforeMergeable || !sawReadyForMerge || stoppedCleanly || fake) return
    // --eco-auto-maintenance (#314) no longer skips the whole run: since #537 this prompt
    // also carries `## Business knowledge`, which the flag does not name. It drops just
    // `## Maintenance` inside renderOnBeforeMergeablePrompt() instead.
    // Every line of the prompt names the session, so there is nothing to queue without one.
    // An agent that made changes has one; this is the agent that ignored the instruction.
    if (!sessionName) {
      io.out('  ! on-before-mergeable skipped: the session never called setSessionName().')
      return
    }
    const binPath = process.argv[1]
    if (!binPath) return
    await runOnBeforeMergeable(
      cwd,
      binPath,
      io,
      { session_name: sessionName, settings: { technical_control: opts.technical } },
      opts.maxCost,
      opts.eco,
    )
  }

  // A mode/kind given with no preset in effect has nothing to act on: note it.
  // Autopilot is the exception — it auto-answers the run's choice gates, which
  // needs no preset. (It no longer steers the prompt's maintenance stance: #556
  // moved that section out, see #801.)
  const presetOnlyModes = modeList.filter(m => m !== 'autopilot')
  if (presetOnlyModes.length && !domainPreset) {
    io.err(`note: ${presetOnlyModes.join(' + ')} mode(s) have no effect without a preset.`)
  }
  if (buildEvent && !domainPreset) {
    io.err(`note: build event "${buildEvent}" has no effect without a preset.`)
  }
  // The sandbox only wraps the serve verification, so it is a no-op without --serve.
  if (opts.sandbox === 'docker' && !opts.serve) {
    io.err(`note: --sandbox docker has no effect without --serve.`)
  }

  // The run owns the browser (#793): launching it here, rather than letting chrome-devtools-mcp
  // launch its own, is what lets the #609 preview attach to the same page. Undefined when the
  // machine has no Chrome, which leaves `--browser` on its old path rather than failing the run.
  const sharedBrowser = opts.browser && !fake ? await launchSharedBrowser() : undefined
  if (opts.browser && !fake && !sharedBrowser) {
    io.err('note: no Chrome found, so --browser falls back to its own browser (no preview).')
  }

  const driver: Driver = fake
    ? fakeDriver()
    : createDriver({ agent: opts.agent, claudeOpts: withBrowser(claudeOpts, opts.browser, sharedBrowser?.browserUrl) })

  // Whether the agent actually ends up with browser tools, which is narrower than the flag: they
  // ride Claude Code's MCP config, so `--browser` on another agent wires nothing (see
  // `unguardedNotices`), and the fake driver has no tools at all. The system channel must only
  // claim a browser the run really has (#824).
  const browserAttached = opts.browser && !fake && opts.agent === 'claude'

  // The preview of that browser (#802): the agent's Chrome is headless, so when it parks on an
  // `await-browser` gate (#796) there is nothing for a human to click. This serves it. Opening
  // the stream costs nothing while the page is still — Chrome only emits a frame on a change.
  const browserStream = sharedBrowser
    ? await startBrowserStream({ browserUrl: sharedBrowser.browserUrl, connect: connectCdp }).catch(() => undefined)
    : undefined
  // A dashboard-started run is spawned with its stdout discarded, so printing the URL reaches
  // nobody (#813). The port goes through onEvent — persisted and published live — which is how
  // the dashboard finds the pane to render.
  // Held until the session opens (see `pendingBrowserPort`) rather than emitted here: the bridge
  // exists before the run does, and an event ahead of `session` never reaches the dashboard (#829).
  // It travels as an event at all because a dashboard-started run is spawned with its stdout
  // discarded, so a printed URL reaches nobody (#813).
  if (browserStream) pendingBrowserPort = browserStream.port

  // The consumption limits (#519/#531). Read from the user's own file rather than
  // taken as a flag: unlike autopilot or eco, a limit is not a per-run choice, so
  // a run started from a terminal is guarded exactly like one started from the
  // dashboard. `undefined` when the agent can't report a quota (the fake driver,
  // or Codex), which leaves the run ungated — the fail-open Rom confirmed.
  // Transparent mode (#625) leaves the run fully raw, so the guard is off with it — the run is
  // `claude -p` with no framework behavior, spend included.
  const guard = transparent ? undefined : startConsumptionGuard({ driver, limits: resolveConsumptionLimits(await readPreferences()) })
  if (transparent) io.out(`◆ transparent: on — raw ${AGENT_SPECS[opts.agent].label}, no framework prompt, guard, dashboard, or TODO loop`)
  else if (guard) io.out('◆ consumption limits: on')
  else if (!fake) {
    io.out(`◆ consumption limits: off — ${AGENT_SPECS[opts.agent].label} reports no quota, so nothing gates your subscription spend.`)
  }

  // A user SYSTEM.md + the anti-lazy-pill toggle shape the system prompt (#301), and the eco
  // flags trim the built-in one (#314). Resolve and echo once, shared by both run paths.
  const promptConfig = await resolvePromptConfig(opts, fileConfig, cwd, io, transparent)

  // The run-scoped state both run paths hand to settleRun to close out. stoppedCleanly is a
  // getter because the onEvent sink sets it as the `end` event arrives.
  const epilogue = (failLabel: string): RunEpilogue => ({
    io,
    dashboard,
    store,
    control,
    guard,
    publisher,
    sharedBrowser,
    browserStream,
    clearInterrupt,
    maybeFireOnBeforeMergeable,
    isStopped: () => controller.signal.aborted || stoppedCleanly,
    failLabel,
  })

  // `framework research [what]` (#331) and `framework prompt <text>` (#353): the
  // direct prompt path — run one prompt through runPrompt, which honors its gates
  // (#337/#339) but skips the scope -> build scaffolding entirely.
  // Transparent (#625) joins them: "raw Claude Code" must bypass the build orchestration
  // AND the prompt wrapping too, not just zero the system prompt — so a transparent run
  // (any kind) runs its prompt verbatim here rather than through runFramework's
  // scope -> build -> synthesize + extendPrompt. Research renders its preset template
  // around the "what" (only when it isn't transparent); prompt/transparent run the text
  // verbatim (it may already BE an edited preset, so it must not be re-rendered).
  // Shares all the wiring above (dashboard, store, control channel, budget).
  const isResearch = opts.research && !transparent
  if (opts.research || opts.directPrompt || transparent) {
    const { userSystemPrompt, noBuiltinPrompt, eco } = promptConfig
    return settleRun(epilogue(isResearch ? 'research' : 'prompt session'), async () => {
      await runPrompt({
        prompt: isResearch ? renderResearchPrompt(intent) : intent,
        driver,
        cwd,
        onEvent,
        signal: controller.signal,
        ...(requestChoice ? { requestChoice } : {}),
        ...(requestChoice ? { messages } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.maxCost ? { budgetUsd: opts.maxCost } : {}),
        ...(guard ? { consumptionGate: guard.gate } : {}),
        ...(userSystemPrompt ? { systemPrompt: userSystemPrompt } : {}),
        ...(noBuiltinPrompt ? { antiLazyPill: false } : {}),
        ...(browserAttached ? { browser: true } : {}),
        ...(transparent ? { transparent: true } : {}),
        ...(eco ? { eco } : {}),
        ...(opts.context.length ? { context: opts.context } : {}),
        ...(modeList.includes('autopilot') ? { autopilot: true } : {}),
        ...(sessionLink ? { sessionLink } : {}),
        ...(opts.resumeSession ? { resumeSessionId: opts.resumeSession } : {}),
      })
      return {
        successLine: isResearch
          ? '\n✓ research done: see the REVIEW-PROBLEMS / TODO files it wrote.'
          : '\n✓ prompt session done.',
      }
    })
  }

  // The fake demo defaults to a Cloudflare deploy decision so the flow ends with
  // a deploy phase; a live run only narrates deploy when asked.
  const deploy: DeployDecision | undefined = opts.deploy
    ? { render: 'ssr', target: opts.deploy, reason: `deploy to ${opts.deploy}` }
    : fake
      ? FAKE_DEPLOY
      : undefined

  // A real deploy target actually ships the app. Only for live runs against a
  // known target; --fake stays plan-only and deterministic. An unknown target
  // just narrates the decision. Real targets never throw on missing creds.
  let deployTarget: DeployTarget | undefined
  if (!fake && opts.deploy) {
    const built = buildDeployTarget(opts.deploy, opts, cwd)
    if (built.error) {
      io.err(built.error)
      io.err('Run `framework --help` for usage.')
      return 2
    }
    deployTarget = built.target
  }

  const serve: ServeConfig | undefined = opts.serve
    ? {
        command: opts.serve,
        // The CLI keeps the dashboard (and app) up until Ctrl+C, so leave the app
        // serving with a preview link once the run succeeds.
        keepAlive: true,
        ...(opts.serveInstall ? { install: opts.serveInstall } : {}),
        ...(opts.serveBuild ? { build: opts.serveBuild } : {}),
        ...(opts.servePort !== undefined ? { port: opts.servePort } : {}),
        ...(opts.servePath ? { healthPath: opts.servePath } : {}),
      }
    : undefined

  const { userSystemPrompt, noBuiltinPrompt, eco } = promptConfig

  const runOpts: RunFrameworkOptions = {
    intent,
    scope: opts.scope,
    driver,
    cwd,
    onEvent,
    signals,
    signal: controller.signal,
    ...(requestChoice ? { requestChoice } : {}),
    ...(requestChoice ? { messages } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.maxPasses ? { maxPasses: opts.maxPasses } : {}),
    ...(opts.maxCost ? { budgetUsd: opts.maxCost } : {}),
    ...(guard ? { consumptionGate: guard.gate } : {}),
    ...(opts.todoLoop && !transparent ? {} : { todoLoop: false }),
    ...(opts.todoMaxItems ? { todoMaxItems: opts.todoMaxItems } : {}),
    ...(deploy ? { deploy } : {}),
    ...(deployTarget ? { deployTarget } : {}),
    ...(serve ? { serve } : {}),
    ...(serve && opts.sandbox ? { sandbox: opts.sandbox } : {}),
    // Modes ride along even without a domain preset: autopilot also steers the
    // #326 system prompt's maintenance stance.
    ...(domainPreset ? { preset: domainPreset } : {}),
    ...(modeList.length ? { modes: modeList } : {}),
    ...(buildEvent ? { buildEvent } : {}),
    ...(userSystemPrompt ? { systemPrompt: userSystemPrompt } : {}),
    ...(noBuiltinPrompt ? { antiLazyPill: false } : {}),
    ...(browserAttached ? { browser: true } : {}),
    ...(transparent ? { transparent: true } : {}),
    ...(eco ? { eco } : {}),
    ...(opts.context.length ? { context: opts.context } : {}),
    ...(sessionLink ? { sessionLink } : {}),
  }

  return settleRun(epilogue('session'), async () => {
    const { result, preview } = await runFramework(runOpts)
    const successLine = result.productionGrade
      ? `\n✓ production-grade in ${result.passes} pass(es).`
      : `\n• prototype ready${result.stoppedEarly ? ` (stopped with ${result.blockers.length} blocker(s))` : ''}.`
    return { successLine, ...(preview ? { preview } : {}) }
  })
}

/**
 * Bare `framework` (no prompt): run the dashboard server in the foreground (#456), so its
 * logs and any server-thrown errors are visible and Ctrl+C stops it. If a background daemon
 * (`framework --daemon`) already owns the port, defer to it rather than fight for the bind.
 * Blocks until the server is signalled (SIGINT/SIGTERM).
 */
async function runForegroundDaemonCmd(opts: CliOptions, io: CliIO): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const existing = await daemonStatus()
  if (existing) {
    io.out(`◆ dashboard already running in the background: ${existing.url}`)
    io.out('  Stop it with `framework stop`, or open the URL above.')
    return 0
  }
  try {
    await runDaemon(cwd, {
      port,
      onListening: state => {
        io.out(`◆ dashboard running: ${state.url}`)
        io.out('  Ctrl+C to stop. Server logs stream below.')
      },
    })
  } catch (err) {
    io.err(`could not start the dashboard (${err instanceof Error ? err.message : String(err)}).`)
    return 1
  }
  return 0
}

/**
 * `framework --daemon` (#456): ensure the persistent background dashboard is running
 * for this workspace, then print the URL, the convenience commands, and the version.
 * Idempotent — a second call just re-reports the live one. Bare `framework` foregrounds
 * the same server instead.
 */
async function ensureDaemonCmd(opts: CliOptions, io: CliIO): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  const port = opts.port ?? DEFAULT_DAEMON_PORT
  let result
  try {
    result = await ensureDaemon(cwd, { port })
  } catch (err) {
    io.err(`could not start the dashboard daemon (${err instanceof Error ? err.message : String(err)}).`)
    return 1
  }
  // One daemon per machine (#393): when it is already running, `framework` in a new repo
  // would not otherwise register that repo (only the daemon's own cwd is added on startup).
  // Register it here too, best-effort, so it shows up in the Projects list either way.
  await registerHomeProject(cwd)

  const { state, alreadyRunning } = result
  io.out(`◆ dashboard ${alreadyRunning ? 'already running' : 'started'}: ${state.url}`)
  io.out('')
  io.out('Type a prompt on the dashboard to start a session, or use:')
  io.out('  framework "<what to build>"   Build (streams to the dashboard)')
  io.out('  framework stop                Stop the background dashboard')
  io.out('  framework --help              All options')
  io.out('')
  io.out(`The Framework v${frameworkVersion()}`)
  const status = await checkForUpdate(frameworkVersion(), nodeVersionFetcher())
  const line = formatUpdateStatus(status)
  if (line) io.out(line)
  return 0
}

/** `framework stop`: stop the machine's background dashboard, if any (#393). */
async function stopDaemonCmd(_opts: CliOptions, io: CliIO): Promise<number> {
  const stopped = await stopDaemon()
  io.out(stopped ? '◆ dashboard stopped.' : 'No background dashboard was running.')
  return 0
}

/**
 * `framework maintain`: the background maintenance sweep (#298). Walks the registered
 * repos, and for each with new commits since its last review runs the maintainability
 * loop (`framework prompt "<maintainability prompt>"`), budget-capped by `--max-cost`
 * and bounded by `--max-repos`. A first-seen repo is baselined (recorded, not reviewed
 * retroactively). `--dry-run` prints the plan without running anything.
 */
async function maintainCmd(opts: CliOptions, io: CliIO): Promise<number> {
  const projects = await listProjects()
  if (projects.length === 0) {
    io.out('No registered projects. Run `framework` in a repo to add one.')
    return 0
  }

  const reviews = await planMaintenanceSweep(
    projects.map(p => ({ id: p.id, path: p.path })),
    nodeGitRunner(),
  )

  if (opts.dryRun) {
    io.out(`Maintenance sweep (dry run) — ${reviews.length} registered repo${reviews.length === 1 ? '' : 's'}:`)
    for (const r of reviews) io.out(`  ${describeReview(r)}`)
    return 0
  }

  const binPath = process.argv[1]
  if (!binPath) {
    io.err('cannot locate the framework CLI entry to run the maintenance loop.')
    return 1
  }

  const summary = await maintainSweep(reviews, {
    run: review => spawnMaintenanceRun(review, binPath, opts.maxCost),
    record: (path, state) => writeMaintenanceState(path, state),
    log: message => io.out(message),
    now: () => new Date().toISOString(),
    ...(opts.maxRepos !== undefined ? { maxRepos: opts.maxRepos } : {}),
  })

  io.out(
    `Sweep done: ${summary.reviewed} reviewed, ${summary.baselined} baselined, ${summary.skipped} up-to-date, ` +
      `${summary.failed} failed${summary.pending ? `, ${summary.pending} pending (--max-repos)` : ''}.`,
  )
  return summary.failed ? 1 : 0
}

/** One line describing a repo's assessed maintenance status, for the dry-run plan. */
function describeReview(r: RepoReview): string {
  const name = basename(r.path)
  switch (r.action) {
    case 'baseline':
      return `${name} — baseline at ${short(r.headSha)} (first seen; nothing reviewed retroactively)`
    case 'review':
      return `${name} — review ${r.newCommits} new commit${r.newCommits === 1 ? '' : 's'} (${short(r.reviewedSha)}..${short(r.headSha)})${r.note ? ` [${r.note}]` : ''}`
    case 'skip':
      return `${name} — up to date`
    case 'error':
      return `${name} — skipped (${r.note ?? 'could not assess'})`
  }
}

/**
 * Run the maintainability loop on one repo by spawning `framework prompt "<prompt>"
 * --cwd <repo> --no-dashboard`, reusing the whole run path (preflight, driver, budget
 * cap, LOGS.md). The child inherits stdio so its run streams to the terminal.
 * Resolves true on a clean exit (0). Never re-execs a test entry (fork-bomb guard).
 */
function spawnMaintenanceRun(review: RepoReview, binPath: string, maxCost?: number): Promise<boolean> {
  // Scope the maintainability pass to the un-reviewed range so the agent knows what to look at.
  const what = review.reviewedSha ? `the changes in ${short(review.reviewedSha)}..${short(review.headSha)}` : 'the recent changes'
  return spawnPromptRun(renderMaintainabilityPrompt(what), review.path, binPath, maxCost)
}

/**
 * The argv a spawned `framework prompt` child runs with. Pure so a test can assert it:
 * note it carries **no** `--on-before-mergeable`, which is the on-before-mergeable recursion guard (a quality
 * pass must not trigger its own suite).
 */
export function promptRunArgs(prompt: string, cwd: string, binPath: string, maxCost?: number, vanilla = false): string[] {
  const args = [binPath, 'prompt', prompt, '--no-dashboard', '--cwd', cwd]
  if (maxCost !== undefined) args.push('--max-cost', String(maxCost))
  // The on-before-mergeable follow-up runs `--vanilla` so it skips the #326 prompt's
  // `### Session name` step: it is a follow-up to a session, not a session of its own,
  // so it must not commit + branch + checkout a new `the-framework/<name>` branch. That
  // stranded its output (the #556 TODO entries and #537 knowledge docs) on a branch
  // nothing merges (#560). Vanilla keeps it on the session's current branch, where its
  // output rides to review and merge with the work. The follow-up prompt is self-contained.
  if (vanilla) args.push('--vanilla')
  return args
}

/**
 * Run one direct prompt by spawning `framework prompt "<prompt>" --cwd <dir> --no-dashboard`,
 * reusing the whole run path (preflight, driver, budget cap, LOGS.md). The child inherits
 * stdio so its run streams to the terminal. Note it carries no `--on-before-mergeable`, so a quality
 * pass never triggers its own on-before-mergeable prompt (the recursion guard). Resolves true on a
 * clean exit (0). Never re-execs a test entry (fork-bomb guard).
 */
function spawnPromptRun(prompt: string, cwd: string, binPath: string, maxCost?: number, vanilla = false): Promise<boolean> {
  if (process.env.NODE_TEST_CONTEXT || /\.test\.[cm]?[jt]s$/.test(binPath)) {
    return Promise.resolve(false) // refuse to spawn from a test entry
  }
  const args = promptRunArgs(prompt, cwd, binPath, maxCost, vanilla)
  return new Promise<boolean>(resolvePromise => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.once('error', () => resolvePromise(false))
    child.once('exit', code => resolvePromise(code === 0))
  })
}

/** How the on-before-mergeable prompt is spawned; injectable so tests observe it without spawning. */
export type PromptRunner = (prompt: string, cwd: string, binPath: string, maxCost?: number) => Promise<boolean>

/**
 * Fire the #326 on-before-mergeable prompt after a run signalled setReadyForMerge(): one
 * `framework prompt` child on the same workspace that appends the quality follow-ups to the
 * session's TODO file, for the backlog loop (#323/#538) to pick up.
 *
 * It used to run maintainability, readability and security-audit inline instead, as three
 * child runs back to back (#556). Queueing is both what the doc says and the cheaper thing:
 * one short turn that writes a few TODO lines, rather than three full preset passes serialized
 * on the same git index. Best-effort, like the suite was: a failure is logged, never thrown.
 */
export async function runOnBeforeMergeable(
  cwd: string,
  binPath: string,
  io: CliIO,
  tf: OnBeforeMergeableContext,
  maxCost?: number,
  eco?: EcoOptions,
  // Vanilla by default: the follow-up must not run the session-name step and branch (#560).
  run: PromptRunner = (prompt, cwd, binPath, maxCost) => spawnPromptRun(prompt, cwd, binPath, maxCost, true),
  fs: StoreFs = nodeStoreFs(),
): Promise<void> {
  // Ensure the presets exist so the queued entries' filePaths resolve, even in a repo
  // activated before they shipped or a fresh clone (they are gitignored) (#598). Best-effort,
  // like the rest of this run: a materialize failure must not block the queueing.
  try {
    await materializePresets(cwd, fs)
  } catch (err) {
    io.out(`  ! on-before-mergeable: could not materialize presets (${err instanceof Error ? err.message : String(err)})`)
  }
  io.out(`\n◆ on-before-mergeable: queueing quality follow-ups for ${tf.session_name}`)
  const ok = await run(renderOnBeforeMergeablePrompt(tf, eco), cwd, binPath, maxCost)
  if (!ok) io.out(`  ! on-before-mergeable queueing did not complete cleanly.`)
}

/**
 * `framework relay`: host the run relay (#230). Teammates open a run's URL
 * (printed when a run uses `--share <this-url>`) and watch it live with full
 * history replay. Runs until interrupted. Unauthenticated by design — anyone with
 * a run URL can watch; accounts/teams/steering come later.
 */
async function runRelayServer(opts: CliOptions, io: CliIO): Promise<number> {
  const relay = await startRelay(opts.port !== undefined ? { port: opts.port } : {})
  io.out(`◆ relay listening at ${relay.url}`)
  io.out(`  Sessions published with \`framework "..." --share ${relay.url}\` are watchable at ${relay.url}/?run=<id>`)
  io.out(`  Press Ctrl+C to stop.`)
  await waitForInterrupt()
  await relay.close()
  return 0
}

/**
 * Reopen the last run from its persisted `.the-framework/` log and replay it into a
 * fresh dashboard (#211). No agent runs; the dashboard rehydrates from the saved
 * event stream and stays up read-only until Ctrl+C.
 */
async function resumeRun(opts: CliOptions, io: CliIO): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  let store: RunStore
  try {
    store = await RunStore.open(cwd, { fresh: false })
  } catch (err) {
    io.err(`could not open .the-framework/ in ${cwd} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  const events = await store.loadEvents()
  if (events.length === 0) {
    io.err(`Nothing to resume: no saved session found in ${store.dir}. Run \`framework "..."\` first.`)
    return 1
  }
  const meta = (await store.readMeta()) ?? store.snapshot()

  // Resume serves the new dashboard too (#427), single-project on this `cwd`: the saved
  // `.the-framework/events.jsonl` is exactly what the SPA's event Channel tails, so the
  // past run replays with no extra wiring (it is finished, so there is nothing to steer).
  // A missing bundle (an old install) replays to the terminal only.
  const dashboard = await startRunDashboard(opts.dashboard, cwd, opts.port, io, {
    resumed: true,
    headlessNote: 'replaying to terminal only',
  })

  for (const event of events) {
    io.out(formatFrameworkEvent(event))
  }
  io.out(`\n• resumed ${meta.status} session of "${meta.intent ?? 'unknown intent'}" (${events.length} event(s), ${meta.passes} pass(es)).`)

  if (dashboard) {
    io.out(`\nDashboard live at ${dashboard.url}. Press Ctrl+C to exit.`)
    await waitForInterrupt()
    await dashboard.close()
  }
  return 0
}

/**
 * Build a real {@link DeployTarget} for a known target name, or return an error /
 * nothing. `cloudflare` runs `wrangler` via a host executor bound to the build's
 * workspace; `dokploy` is a fetch to a self-hosted instance. Creds come from the
 * environment (CLOUDFLARE_API_TOKEN / DOKPLOY_AUTH_TOKEN).
 */
export function buildDeployTarget(
  name: string,
  opts: Pick<CliOptions, 'cfProject' | 'dokployUrl' | 'dokployApp'>,
  cwd: string,
): { target?: DeployTarget; error?: string } {
  if (name === 'cloudflare') {
    return {
      target: cloudflareTarget({
        session: hostExecutor(cwd),
        ...(opts.cfProject ? { projectName: opts.cfProject } : {}),
      }),
    }
  }
  if (name === 'dokploy') {
    if (!opts.dokployUrl || !opts.dokployApp) {
      return { error: '--deploy dokploy requires --dokploy-url and --dokploy-app' }
    }
    return { target: dokployTarget({ serverUrl: opts.dokployUrl, applicationId: opts.dokployApp }) }
  }
  return {} // Unknown target: narrate the decision only.
}

/** The post-run wait: keep the dashboard up until Ctrl+C, then close it. */
async function keepDashboardUp(dashboard: Dashboard, io: CliIO): Promise<void> {
  io.out(`\nDashboard still live at ${dashboard.url}. Press Ctrl+C to exit.`)
  await waitForInterrupt()
  await dashboard.close()
}

/** Resolve when the process is interrupted (Ctrl+C), so the dashboard stays up. */
function waitForInterrupt(): Promise<void> {
  return new Promise(resolvePromise => {
    const done = () => {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      resolvePromise()
    }
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
  })
}
