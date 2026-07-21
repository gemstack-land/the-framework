import type {
  Runner,
  RunnerSession,
  RunnerFs,
  RunnerProcess,
  BootOptions,
  ExecOptions,
  ExecResult,
  Preview,
  PreviewOptions,
} from './types.js'
import { RunnerError } from './types.js'
import { safeSegments } from './path.js'

// The fake's canonical map key: the same rules the real runners enforce — reject a
// path that escapes the workspace, resolve `.`/`..`. Routing every path through it
// keeps code exercised only against the fake honest about the one path most worth
// exercising. Empty string is the workspace root, which no file names.
function fsKey(path: string): string {
  return safeSegments(path).join('/')
}

/** How the fake responds to a command: a static result or a per-command function. */
export type FakeExec = (command: string, opts: ExecOptions) => ExecResult | Promise<ExecResult>

export interface FakeRunnerOptions {
  /** Canned `exec` behavior. Default: exit 0, empty stdout/stderr. */
  onExec?: FakeExec
  /** Whether booted sessions can serve a preview. Default `true`. */
  preview?: boolean
  /** Base URL returned by `preview()`. Default `https://preview.fake.local`. */
  previewUrl?: string
  /** Whether booted sessions can `start` background processes. Default `true`. */
  background?: boolean
}


class FakeFs implements RunnerFs {
  constructor(private readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const p = fsKey(path)
    if (!this.files.has(p)) throw new RunnerError(`no such file: ${path}`)
    return this.files.get(p)!
  }

  async write(path: string, contents: string): Promise<void> {
    this.files.set(fsKey(path), contents)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(fsKey(path))
  }

  async list(dir?: string): Promise<string[]> {
    // `.` and `/` key to the empty string, the workspace root, so they must list
    // everything as the real runners do — not `'/'`, which no key starts with (#998).
    const key = dir === undefined ? '' : fsKey(dir)
    const prefix = key ? key + '/' : ''
    return [...this.files.keys()].filter(p => p.startsWith(prefix)).sort()
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(fsKey(path))
  }
}

/** A recorded `exec` invocation, for test assertions. */
export interface RecordedExec {
  command: string
  opts: ExecOptions
}

/** A recorded `start` invocation, for test assertions. */
export interface RecordedStart {
  command: string
  opts: ExecOptions
}

/** The session a {@link FakeRunner} boots — exposes its state for assertions. */
export class FakeRunnerSession implements RunnerSession {
  readonly id: string
  readonly fs: FakeFs
  /** Every `exec` call in order, so tests can assert what autopilot ran. */
  readonly execCalls: RecordedExec[] = []
  /** Set once `dispose()` has run. */
  disposed = false

  /**
   * Present only when the runner supports previews — presence is the capability
   * signal, so it is an own property assigned in the constructor (not a
   * prototype method, which could not be conditionally omitted).
   */
  readonly preview?: (opts?: PreviewOptions) => Promise<Preview>

  /** Present only when the runner supports background processes (capability signal). */
  readonly start?: (command: string, opts?: ExecOptions) => Promise<RunnerProcess>
  /** Every `start` call in order, so tests can assert what autopilot launched. */
  readonly startCalls: RecordedStart[] = []
  /** The background processes started this session, in order. */
  readonly processes: RunnerProcess[] = []

  private readonly files = new Map<string, string>()

  constructor(
    id: string,
    boot: BootOptions,
    private readonly opts: Required<Pick<FakeRunnerOptions, 'onExec' | 'preview' | 'previewUrl' | 'background'>>,
  ) {
    this.id = id
    for (const [path, contents] of Object.entries(boot.files ?? {})) {
      this.files.set(fsKey(path), contents)
    }
    this.fs = new FakeFs(this.files)
    if (opts.preview) {
      this.preview = async (previewOpts: PreviewOptions = {}): Promise<Preview> => {
        if (this.disposed) throw new RunnerError('preview on a disposed session')
        const port = previewOpts.port ?? 3000
        return { url: `${this.opts.previewUrl}:${port}`, port }
      }
    }
    if (opts.background) {
      this.start = async (command: string, startOpts: ExecOptions = {}): Promise<RunnerProcess> => {
        if (this.disposed) throw new RunnerError('start on a disposed session')
        this.startCalls.push({ command, opts: startOpts })
        let resolveExit!: (r: ExecResult) => void
        const exit = new Promise<ExecResult>(res => (resolveExit = res))
        let settled = false
        const proc: RunnerProcess = {
          command,
          exit,
          stop: async () => {
            if (settled) return
            settled = true
            resolveExit({ stdout: '', stderr: '', exitCode: 0 })
          },
        }
        this.processes.push(proc)
        return proc
      }
    }
  }

  /** A snapshot of the workspace files, for assertions. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files)
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this.disposed) throw new RunnerError('exec on a disposed session')
    this.execCalls.push({ command, opts })
    return this.opts.onExec(command, opts)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all(this.processes.map(p => p.stop().catch(() => {})))
  }
}

/**
 * An in-memory {@link Runner} for tests: an in-memory filesystem, a programmable
 * `exec`, and recorded calls — the runner analog of `ai-sdk`'s `AiFake`. Drive
 * autopilot against it without any sandbox infra.
 *
 * ```ts
 * const runner = new FakeRunner({ onExec: (cmd) =>
 *   cmd.startsWith('pnpm build') ? { stdout: 'ok', stderr: '', exitCode: 0 }
 *                                : { stdout: '', stderr: '', exitCode: 0 } })
 * const s = await runner.boot({ files: { 'pages/+Page.jsx': '…' } })
 * await s.exec('pnpm build')
 * s.execCalls // → [{ command: 'pnpm build', opts: {} }]
 * ```
 */
export class FakeRunner implements Runner {
  readonly kind = 'fake'
  /** Every session this runner has booted. */
  readonly sessions: FakeRunnerSession[] = []

  private readonly opts: Required<Pick<FakeRunnerOptions, 'onExec' | 'preview' | 'previewUrl' | 'background'>>
  private counter = 0

  constructor(options: FakeRunnerOptions = {}) {
    this.opts = {
      onExec: options.onExec ?? (async () => ({ stdout: '', stderr: '', exitCode: 0 })),
      preview: options.preview ?? true,
      previewUrl: options.previewUrl ?? 'https://preview.fake.local',
      background: options.background ?? true,
    }
  }

  async boot(opts: BootOptions = {}): Promise<FakeRunnerSession> {
    const session = new FakeRunnerSession(`fake-session-${++this.counter}`, opts, this.opts)
    this.sessions.push(session)
    return session
  }
}
