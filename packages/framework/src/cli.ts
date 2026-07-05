import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  builtinDomainPresets,
  cloudflareTarget,
  dokployTarget,
  nodeLedgerFs,
  saveLedger,
  selectPreset,
  type DeployTarget,
  type DomainPreset,
  type FrameworkSignals,
} from '@gemstack/ai-autopilot'
import { ClaudeCodeDriver, type ClaudeCodeDriverOptions, type Driver, type DriverSession, type PermissionMode } from './driver/index.js'
import { hostExecutor } from './host-exec.js'
import { startDashboard, type Dashboard } from './dashboard/index.js'
import { formatFrameworkEvent, CLAUDE_CODE_SESSION_LINK, type FrameworkEvent } from './events.js'
import {
  runFramework,
  type DeployDecision,
  type RunFrameworkOptions,
  type RunFrameworkResult,
  type ServeConfig,
} from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import { discoverExtensions, readProjectSignals } from './extensions.js'
import {
  META_SELECT_SYSTEM,
  metaSelect,
  presetCatalog,
  type MetaSelection,
} from './meta-select.js'
import { isWorkspaceEmpty } from './steps.js'
import { loadFrameworkConfig, type FrameworkFileConfig } from './config.js'
import { loadRepoMemory } from './memory.js'
import { preflight } from './preflight.js'
import { RunStore } from './store/index.js'

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
 */
export function chooseSessionLink(opts: Pick<CliOptions, 'sessionLink'>, fake: boolean): string | undefined {
  if (opts.sessionLink) return opts.sessionLink
  return fake ? undefined : CLAUDE_CODE_SESSION_LIST
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
  --preset <name>        Run under an Open Loop domain preset (its loops + prompts
                         + skills frame the build), e.g. software-development.
                         Omit it and a live run auto-picks the best-fit preset +
                         modes from your prompt + workspace (--no-auto-preset off).
  --no-auto-preset       Do not auto-pick a preset; run the plain framework flow
                         unless --preset / the-framework.yml sets one.
  --autopilot            Activate the preset's Autopilot mode variants.
  --technical            Activate the preset's Technical mode variants.
                         (--preset / --autopilot / --technical / --kind can also be
                          set per repo in the-framework.yml; these flags override it.)
  --kind <name>          Build event kind the preset's review loop fires for, e.g.
                         bug-fix or major-change (default: the-framework.yml's event,
                         else the preset's own, else major-change). Selects which
                         review chain gates the run.
  --compose-extensions   Opt the built-in capability extensions in (auth, data,
                         rbac, crud, shell) so the agent composes them instead of
                         hand-rolling. Vike-only; installed framework-* extensions
                         auto-activate either way (default: off, hand-rolled + Prisma).
  --max-passes <n>       Full-fledged loop pass budget (default: 5).
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
  --deploy <target>      Deploy to this target (cloudflare, dokploy) or narrate any other.
  --cf-project <name>    Cloudflare Pages project name (for a Pages deploy).
  --dokploy-url <url>    Dokploy instance URL (required for --deploy dokploy).
  --dokploy-app <id>     Dokploy application id (required for --deploy dokploy).
  --port <n>             Dashboard port (default: 4477).
  --no-dashboard         Do not start the localhost dashboard.
  --resume               Reopen the last run's dashboard from .framework/ in --cwd
                         (read-only replay; no new agent run). Survives a restart.
  --no-persist           Do not write the orchestration state to .framework/.
  --skip-preflight       Skip the prerequisite checks before a live run.
  --session-link <url>   A real per-session link to the live agent session, shown
                         on the dashboard. Our runs are headless (not Remote-
                         Controlled), so by default the dashboard only offers the
                         generic "Open Claude Code" entry point. Pass your own URL,
                         using {sessionId} to template in the real Claude session
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
  preset?: string | undefined
  autoPreset: boolean
  autopilot: boolean
  technical: boolean
  buildEvent?: string | undefined
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
  composeExtensions: boolean
  sessionLink?: string | undefined
  permissionMode?: PermissionMode | undefined
  skipPermissions: boolean
  resume: boolean
  persist: boolean
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
    autoPreset: true,
    autopilot: false,
    technical: false,
    dashboard: true,
    composeExtensions: false,
    skipPermissions: false,
    resume: false,
    persist: true,
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
      case '--compose-extensions':
        opts.composeExtensions = true
        break
      case '--preset':
        opts.preset = argv[++i]
        break
      case '--no-auto-preset':
        opts.autoPreset = false
        break
      case '--autopilot':
        opts.autopilot = true
        break
      case '--technical':
        opts.technical = true
        break
      case '--kind':
        opts.buildEvent = argv[++i]
        break
      case '--resume':
        opts.resume = true
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

/** The active Open Loop modes from the mode flags, in a stable order. */
export function activeModes(opts: Pick<CliOptions, 'autopilot' | 'technical'>): string[] {
  const modes: string[] = []
  if (opts.autopilot) modes.push('autopilot')
  if (opts.technical) modes.push('technical')
  return modes
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

/** A one-line summary of the workspace for the meta-select router: empty vs existing + a few deps. */
export function workspaceSummary(cwd: string, signals: FrameworkSignals): string {
  if (isWorkspaceEmpty(cwd)) return 'empty (a from-scratch build)'
  const deps = signals.dependencies
  const names = Array.isArray(deps) ? deps : Object.keys(deps ?? {})
  if (names.length === 0) return 'an existing project'
  const shown = names.slice(0, 12).join(', ')
  return `an existing project (dependencies: ${shown}${names.length > 12 ? ', …' : ''})`
}

/**
 * AI meta-select (#204): infer the best-fit domain preset (+ modes + build event)
 * from the intent + workspace when the user did not pick one. Spins up a
 * short-lived driver session for a single routing prompt, then disposes it. Any
 * failure (agent error, junk reply) degrades to `undefined` = the plain flow, so
 * a run is never blocked by the auto-pick.
 */
export async function autoSelectPreset(opts: {
  intent: string
  cwd: string
  signals: FrameworkSignals
  claudeOpts: ClaudeCodeDriverOptions
  signal?: AbortSignal
  io: CliIO
  /** The driver to route the pick through. Defaults to a Claude Code driver; injected in tests. */
  driver?: Driver
}): Promise<MetaSelection | undefined> {
  const catalog = presetCatalog(await builtinDomainPresets())
  if (catalog.length === 0) return undefined
  const driver = opts.driver ?? new ClaudeCodeDriver(opts.claudeOpts)
  let session: DriverSession | undefined
  try {
    session = await driver.start({
      cwd: opts.cwd,
      system: META_SELECT_SYSTEM,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return await metaSelect(session, {
      intent: opts.intent,
      catalog,
      workspace: workspaceSummary(opts.cwd, opts.signals),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } catch (err) {
    opts.io.err(`auto-select skipped (${err instanceof Error ? err.message : String(err)}); using the plain framework flow.`)
    return undefined
  } finally {
    await session?.dispose()
  }
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

  // Resume a previous run's dashboard from its persisted log — the reload half of
  // #211. No agent runs; we just replay the saved events into a fresh stream so
  // the dashboard rehydrates exactly as it looked, then leave it up read-only.
  if (opts.resume) return resumeRun(opts, io)

  const fake = opts.fake
  const intent = opts.intent || (fake ? FAKE_INTENT : '')
  if (!intent) {
    io.err('Describe what to build, e.g. `framework "a blog with comments"` (or try `framework --fake`).')
    return 2
  }

  const cwd = opts.cwd ?? (fake ? join(tmpdir(), 'framework-fake-workspace') : process.cwd())

  // The project can carry its own Open Loop defaults in the-framework.yml (#258):
  // which domain preset + modes to build under. CLI flags override the file; a bad
  // file is a warning, never a failed run. Read from the run's own workspace, so a
  // --fake demo (empty tmp cwd) stays deterministic unless pointed at a config dir.
  const fileConfig = await loadFrameworkConfig(cwd, msg => io.err(msg))
  const fromFile = describeConfigSource(opts, fileConfig)
  if (fromFile) io.out(`◆ the-framework.yml: ${fromFile}`)

  // Fail early and clearly if a live run's prerequisites are missing — before any
  // preset work, since auto-select and the run both need the wrapped agent.
  if (!fake && !opts.skipPreflight) {
    const pre = await preflight()
    if (!pre.ok) {
      for (const check of pre.checks.filter(c => !c.ok)) io.err(`✗ ${check.name}: ${check.detail}`)
      io.err('Preflight failed. Fix the above, or pass --skip-preflight, or try `framework --fake`.')
      return 2
    }
  }

  const claudeOpts = claudeDriverOptions(opts)
  // Detection signals: fixed for the fake demo, read from the project otherwise.
  // Computed once here, reused by auto-select, extension discovery, and the run.
  const signals = fake ? FAKE_SIGNALS : readProjectSignals(cwd)
  // One controller for the whole run (and the auto-select turn before it): the
  // dashboard Stop button aborts it once wired below.
  const controller = new AbortController()

  // Resolve which Open Loop domain preset (+ modes + build event) to run under.
  // Precedence: an explicit --preset / the-framework.yml wins; else, on a live run,
  // AI meta-select infers the best fit from the intent + workspace (#204). CLI mode
  // flags still OR in on top of an inferred preset; --no-auto-preset / --fake skip it.
  const merged = mergeRunConfig(opts, fileConfig)
  let presetName = merged.presetName
  let modeList = activeModes(merged)
  let buildEvent = merged.buildEvent
  if (!fake && opts.autoPreset && !presetName) {
    const selection = await autoSelectPreset({ intent, cwd, signals, claudeOpts, signal: controller.signal, io })
    if (selection?.preset) {
      presetName = selection.preset
      modeList = [...new Set([...modeList, ...selection.modes])]
      buildEvent = buildEvent ?? selection.buildEvent
      const modeNote = modeList.length ? ` (modes: ${modeList.join(', ')})` : ''
      const kindNote = selection.buildEvent && !merged.buildEvent ? `, ${selection.buildEvent}` : ''
      io.out(`◆ auto-selected preset: ${presetName}${modeNote}${kindNote}${selection.why ? ` — ${selection.why}` : ''}`)
    } else {
      io.out(`◆ auto-select: no preset fits${selection?.why ? ` (${selection.why})` : ''}; using the plain framework flow.`)
    }
  }

  // A bad --preset name is a usage error; the mode/kind notes fire when they have
  // no preset to act on (a flag/file value given without one).
  const { preset: domainPreset, error: presetError } = await resolveDomainPreset(presetName, modeList)
  if (presetError) {
    io.err(presetError)
    io.err('Run `framework --help` for usage.')
    return 2
  }
  if (modeList.length && !domainPreset) {
    io.err(`note: ${modeList.join(' + ')} mode(s) have no effect without a preset.`)
  }
  if (buildEvent && !domainPreset) {
    io.err(`note: build event "${buildEvent}" has no effect without a preset.`)
  }

  const driver: Driver = fake ? fakeDriver() : new ClaudeCodeDriver(claudeOpts)
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

  // The dashboard Stop button aborts the run-wide controller created above.
  // runFramework checks the signal between phases and the driver kills its current
  // turn on it, so a stop takes effect promptly.
  let dashboard: Dashboard | undefined
  if (opts.dashboard) {
    try {
      dashboard = await startDashboard({
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        onStop: () => controller.abort(),
      })
      io.out(`◆ dashboard: ${dashboard.url}`)
    } catch (err) {
      io.err(`could not start dashboard (${err instanceof Error ? err.message : String(err)}); continuing headless`)
    }
  }

  // Persist the orchestration state so a restart can --resume it (#211). The log
  // is the dashboard's own event stream, appended to .framework/ in the workspace.
  // Best-effort: a store that fails to open just means no persistence, never a
  // failed run. --no-persist opts out entirely.
  let store: RunStore | undefined
  if (opts.persist) {
    try {
      store = await RunStore.open(cwd, { fresh: true })
    } catch (err) {
      io.err(`could not persist run state (${err instanceof Error ? err.message : String(err)}); continuing without it`)
    }
  }

  const onEvent = (event: FrameworkEvent) => {
    io.out(formatFrameworkEvent(event))
    dashboard?.push(event)
    void store?.append(event)
  }

  // Discover installed `framework-*` capability packages (#190) from the signals
  // read above and register them; each still activates by signal or the
  // --compose-extensions opt-in.
  let discovered: RunFrameworkOptions['extensions']
  if (!fake) {
    const { extensions, failed } = await discoverExtensions(cwd, signals)
    for (const f of failed) io.err(`skipped framework extension ${f.package}: ${f.error}`)
    if (extensions.length) discovered = extensions
  }

  // The repo's own memory files (#260) frame the agent: it reads them for context
  // and keeps the ones it owns current. Read from the run's workspace; --fake's
  // empty tmp cwd simply has none, so the demo stays deterministic.
  const memory = await loadRepoMemory(cwd)
  if (memory.some(m => m.content)) io.out(`◆ project memory: ${memory.filter(m => m.content).map(m => m.name).join(', ')}`)

  const runOpts: RunFrameworkOptions = {
    intent,
    scope: opts.scope,
    driver,
    cwd,
    onEvent,
    signals,
    signal: controller.signal,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.maxPasses ? { maxPasses: opts.maxPasses } : {}),
    ...(deploy ? { deploy } : {}),
    ...(deployTarget ? { deployTarget } : {}),
    ...(serve ? { serve } : {}),
    ...(discovered ? { extensions: discovered } : {}),
    ...(opts.composeExtensions ? { composeExtensions: true } : {}),
    ...(domainPreset ? { preset: domainPreset, ...(modeList.length ? { modes: modeList } : {}) } : {}),
    ...(buildEvent ? { buildEvent } : {}),
    ...(memory.length ? { memory } : {}),
    ...((): { sessionLink?: string } => {
      const link = chooseSessionLink(opts, fake)
      return link ? { sessionLink: link } : {}
    })(),
  }

  try {
    const { result, preview, ledger } = await runFramework(runOpts)
    io.out(
      result.productionGrade
        ? `\n✓ production-grade in ${result.passes} pass(es).`
        : `\n• prototype ready${result.stoppedEarly ? ` (stopped with ${result.blockers.length} blocker(s))` : ''}.`,
    )
    if (preview) io.out(`\n▶ Your app is running at ${preview.url} — open it in a browser.`)
    // Flush the event log, and drop a human-readable DECISIONS.md beside it so the
    // ledger is legible without the dashboard. Both best-effort.
    await store?.close()
    await writeDecisions(cwd, ledger, io)
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
    await store?.close()
    // A user stop (the dashboard Stop button aborted the signal) is not a failure:
    // report it cleanly, keep the dashboard up so the stopped state is visible, and
    // exit 0.
    if (controller.signal.aborted) {
      io.out('\n■ Stopped.')
      if (dashboard) {
        io.out(`\nDashboard still live at ${dashboard.url}. Press Ctrl+C to exit.`)
        await waitForInterrupt()
        await dashboard.close()
      }
      return 0
    }
    io.err(`\n✗ run failed: ${err instanceof Error ? err.message : String(err)}`)
    await dashboard?.close()
    return 1
  }
}

/**
 * Reopen the last run from its persisted `.framework/` log and replay it into a
 * fresh dashboard (#211). No agent runs; the dashboard rehydrates from the saved
 * event stream and stays up read-only until Ctrl+C.
 */
async function resumeRun(opts: CliOptions, io: CliIO): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  let store: RunStore
  try {
    store = await RunStore.open(cwd, { fresh: false })
  } catch (err) {
    io.err(`could not open .framework/ in ${cwd} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  const events = await store.loadEvents()
  if (events.length === 0) {
    io.err(`Nothing to resume: no saved run found in ${store.dir}. Run \`framework "..."\` first.`)
    return 1
  }
  const meta = (await store.readMeta()) ?? store.snapshot()

  let dashboard: Dashboard | undefined
  if (opts.dashboard) {
    try {
      dashboard = await startDashboard(opts.port !== undefined ? { port: opts.port } : {})
      io.out(`◆ dashboard (resumed): ${dashboard.url}`)
    } catch (err) {
      io.err(`could not start dashboard (${err instanceof Error ? err.message : String(err)}); replaying to terminal only`)
    }
  }

  for (const event of events) {
    io.out(formatFrameworkEvent(event))
    dashboard?.push(event)
  }
  io.out(`\n• resumed ${meta.status} run of "${meta.intent ?? 'unknown intent'}" (${events.length} event(s), ${meta.passes} pass(es)).`)

  if (dashboard) {
    io.out(`\nDashboard live at ${dashboard.url}. Press Ctrl+C to exit.`)
    await waitForInterrupt()
    await dashboard.close()
  }
  return 0
}

/**
 * Persist the decisions ledger as a human-readable `DECISIONS.md` at the
 * workspace root, reusing ai-autopilot's markdown store. Best-effort: a write
 * failure is reported but never fails the run.
 */
async function writeDecisions(cwd: string, ledger: RunFrameworkResult['ledger'], io: CliIO): Promise<void> {
  if (ledger.all().length === 0) return
  try {
    await saveLedger(nodeLedgerFs(), ledger, join(cwd, 'DECISIONS.md'))
  } catch (err) {
    io.err(`could not write DECISIONS.md (${err instanceof Error ? err.message : String(err)})`)
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
