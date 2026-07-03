import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloudflareTarget, dokployTarget, type DeployTarget } from '@gemstack/ai-autopilot'
import { ClaudeCodeDriver, type ClaudeCodeDriverOptions, type Driver, type PermissionMode } from './driver/index.js'
import { hostExecutor } from './host-exec.js'
import { startDashboard, type Dashboard } from './dashboard/index.js'
import { formatFrameworkEvent, type FrameworkEvent } from './events.js'
import { runFramework, type DeployDecision, type RunFrameworkOptions, type ServeConfig } from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import { preflight } from './preflight.js'

/** Where the CLI writes. Injectable so tests capture output. */
export interface CliIO {
  out: (line: string) => void
  err: (line: string) => void
}

const defaultIO: CliIO = {
  out: line => process.stdout.write(line + '\n'),
  err: line => process.stderr.write(line + '\n'),
}

const VERSION = '0.0.0'

const HELP = `The Framework — turnkey AI orchestration that wraps a coding agent (Claude Code).

Usage:
  framework [intent...]           Build what you describe, from scratch.
  framework --fake                Run the offline demo (no CLI, no model, deterministic).
  framework doctor                Check prerequisites (Claude Code installed, etc.).

Options:
  --fake                 Use the fake driver + scripted run (offline / CI).
  --cwd <dir>            Workspace the agent builds in (default: current directory).
  --model <id>           Model to pass through to the wrapped agent.
  --scope <prototype|full>   How much app to build (default: full).
  --max-passes <n>       Full-fledged loop pass budget (default: 3).
  --permission-mode <mode>   Claude Code permission mode: default | acceptEdits |
                             bypassPermissions | plan (default: acceptEdits).
  --dangerously-skip-permissions   Bypass all agent permission checks (sandboxes only).
  --serve <cmd>          Gate the loop on the app actually running (e.g. "npm run dev"),
                         then keep it serving with a preview link on the dashboard.
  --serve-install <cmd>  Install command before serving (e.g. "npm install").
  --serve-build <cmd>    Build command before serving (e.g. "npm run build").
  --serve-port <n>       Port the app listens on (default: 3000).
  --serve-path <path>    Path to health-check once it is up (default: /).
  --deploy <target>      Deploy to this target (cloudflare, dokploy) or narrate any other.
  --cf-project <name>    Cloudflare Pages project name (for a Pages deploy).
  --dokploy-url <url>    Dokploy instance URL (required for --deploy dokploy).
  --dokploy-app <id>     Dokploy application id (required for --deploy dokploy).
  --port <n>             Dashboard port (default: 4477).
  --no-dashboard         Do not start the localhost dashboard.
  --skip-preflight       Skip the prerequisite checks before a live run.
  --session-link <url>   Link to the live agent session (shown on the dashboard).
                         Use {sessionId} as a placeholder to template in the real
                         id, e.g. "https://example.com/s/{sessionId}".
  -h, --help             Show this help.
  -v, --version          Print the version.

The Framework drives the wrapped agent as a black box: it prompts, reads the code,
and gates on the outcome (builds / serves / review-passes), then re-prompts. The
localhost dashboard foregrounds the stack rationale, the loop status, and the
decisions ledger beside the agent's own session.`

/** Parsed CLI options. */
export interface CliOptions {
  help: boolean
  version: boolean
  fake: boolean
  doctor: boolean
  skipPreflight: boolean
  intent: string
  cwd?: string | undefined
  model?: string | undefined
  scope: 'prototype' | 'full'
  maxPasses?: number
  deploy?: string | undefined
  cfProject?: string | undefined
  dokployUrl?: string | undefined
  dokployApp?: string | undefined
  serve?: string | undefined
  serveInstall?: string | undefined
  serveBuild?: string | undefined
  servePort?: number
  servePath?: string | undefined
  port?: number
  dashboard: boolean
  sessionLink?: string | undefined
  permissionMode?: PermissionMode | undefined
  skipPermissions: boolean
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
    scope: 'full',
    dashboard: true,
    skipPermissions: false,
  }
  const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan']
  const words: string[] = []
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
      case '--cwd':
        opts.cwd = argv[++i]
        break
      case '--model':
        opts.model = argv[++i]
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
        const n = Number(argv[++i])
        if (!Number.isInteger(n) || n < 1) opts.error = `invalid --serve-port: must be a positive integer`
        else opts.servePort = n
        break
      }
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
        const n = Number(argv[++i])
        if (!Number.isInteger(n) || n < 1) opts.error = `invalid --max-passes: must be a positive integer`
        else opts.maxPasses = n
        break
      }
      case '--port': {
        const n = Number(argv[++i])
        if (!Number.isInteger(n) || n < 0) opts.error = `invalid --port: must be a non-negative integer`
        else opts.port = n
        break
      }
      default:
        if (arg.startsWith('-')) opts.error = `unknown option: ${arg}`
        else words.push(arg)
    }
  }
  // `framework doctor` is a subcommand, not an intent.
  if (words[0] === 'doctor') {
    opts.doctor = true
    words.shift()
  }
  opts.intent = words.join(' ').trim()
  return opts
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
    io.out(VERSION)
    return 0
  }
  if (opts.doctor) {
    const result = await preflight()
    for (const check of result.checks) io.out(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`)
    io.out(result.ok ? '\nAll good. You are ready to build.' : '\nSome checks failed. Fix them, then try again.')
    return result.ok ? 0 : 1
  }

  const fake = opts.fake
  const intent = opts.intent || (fake ? FAKE_INTENT : '')
  if (!intent) {
    io.err('Describe what to build, e.g. `framework "a blog with comments"` (or try `framework --fake`).')
    return 2
  }

  // Fail early and clearly if a live run's prerequisites are missing.
  if (!fake && !opts.skipPreflight) {
    const pre = await preflight()
    if (!pre.ok) {
      for (const check of pre.checks.filter(c => !c.ok)) io.err(`✗ ${check.name}: ${check.detail}`)
      io.err('Preflight failed. Fix the above, or pass --skip-preflight, or try `framework --fake`.')
      return 2
    }
  }

  const claudeOpts: ClaudeCodeDriverOptions = {
    ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
    ...(opts.skipPermissions ? { dangerouslySkipPermissions: true } : {}),
  }
  const driver: Driver = fake ? fakeDriver() : new ClaudeCodeDriver(claudeOpts)
  const cwd = opts.cwd ?? (fake ? join(tmpdir(), 'framework-fake-workspace') : process.cwd())
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

  let dashboard: Dashboard | undefined
  if (opts.dashboard) {
    try {
      dashboard = await startDashboard(opts.port !== undefined ? { port: opts.port } : {})
      io.out(`◆ dashboard: ${dashboard.url}`)
    } catch (err) {
      io.err(`could not start dashboard (${err instanceof Error ? err.message : String(err)}); continuing headless`)
    }
  }

  const onEvent = (event: FrameworkEvent) => {
    io.out(formatFrameworkEvent(event))
    dashboard?.push(event)
  }

  const runOpts: RunFrameworkOptions = {
    intent,
    scope: opts.scope,
    driver,
    cwd,
    onEvent,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.maxPasses ? { maxPasses: opts.maxPasses } : {}),
    ...(deploy ? { deploy } : {}),
    ...(deployTarget ? { deployTarget } : {}),
    ...(serve ? { serve } : {}),
    ...(fake ? { signals: FAKE_SIGNALS } : {}),
    ...(opts.sessionLink ? { sessionLink: opts.sessionLink } : {}),
  }

  try {
    const { result, preview } = await runFramework(runOpts)
    io.out(
      result.productionGrade
        ? `\n✓ production-grade in ${result.passes} pass(es).`
        : `\n• prototype ready${result.stoppedEarly ? ` (stopped with ${result.blockers.length} blocker(s))` : ''}.`,
    )
    if (preview) io.out(`\n▶ Your app is running at ${preview.url} — open it in a browser.`)
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
    io.err(`\n✗ run failed: ${err instanceof Error ? err.message : String(err)}`)
    await dashboard?.close()
    return 1
  }
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
