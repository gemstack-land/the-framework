import type {
  WebContainer as WebContainerInstance,
  WebContainerProcess,
  SpawnOptions,
  FileSystemAPI,
} from '@webcontainer/api'
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

const delay = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms))

/**
 * True when the current context can boot a WebContainer: a browser (or worker)
 * that is cross-origin isolated. WebContainer needs `SharedArrayBuffer`, which
 * needs cross-origin isolation (COOP/COEP). Always `false` in plain Node — the
 * runner analog of {@link dockerAvailable}, letting callers/tests skip when the
 * capability is absent.
 */
export function webContainerAvailable(): boolean {
  const g = globalThis as { crossOriginIsolated?: boolean }
  return typeof g.crossOriginIsolated === 'boolean' && g.crossOriginIsolated === true
}

/**
 * Only one WebContainer can be booted per page ({@link WebContainerInstance.boot}
 * throws otherwise), so a live session is tracked process-wide and released on
 * dispose. A second `boot()` while one is live is a clear error, not a crash.
 */
let live: WebContainerRunnerSession | null = null

/** Normalize a workspace path to a canonical relative form (matches LocalFs/FakeFs). */
function norm(path: string): string {
  return path.replace(/^\.?\/+/, '').replace(/\/+$/, '')
}

/** Resolve `path` to a workspace-relative form, rejecting anything that escapes it. */
function within(path: string): string {
  const parts: string[] = []
  for (const seg of norm(path).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) throw new RunnerError(`path escapes the workspace: ${path}`)
      parts.pop()
    } else parts.push(seg)
  }
  return parts.length ? parts.join('/') : '.'
}

/** A {@link RunnerFs} backed by a WebContainer's in-browser filesystem. */
class WebContainerFs implements RunnerFs {
  constructor(private readonly fs: FileSystemAPI) {}

  async read(path: string): Promise<string> {
    try {
      return await this.fs.readFile(within(path), 'utf-8')
    } catch (err) {
      if (err instanceof RunnerError) throw err
      throw new RunnerError(`no such file: ${path}`)
    }
  }

  async write(path: string, contents: string): Promise<void> {
    const p = within(path)
    const slash = p.lastIndexOf('/')
    if (slash > 0) await this.fs.mkdir(p.slice(0, slash), { recursive: true })
    await this.fs.writeFile(p, contents)
  }

  async remove(path: string): Promise<void> {
    await this.fs.rm(within(path), { recursive: true, force: true })
  }

  async list(dir?: string): Promise<string[]> {
    const base = dir ? within(dir) : '.'
    const out: string[] = []
    const walk = async (rel: string): Promise<void> => {
      let entries
      try {
        entries = await this.fs.readdir(rel, { withFileTypes: true })
      } catch {
        return // missing dir → empty, mirroring LocalFs
      }
      for (const e of entries) {
        const child = rel === '.' ? e.name : `${rel}/${e.name}`
        if (e.isDirectory()) await walk(child)
        else out.push(child)
      }
    }
    await walk(base)
    return out.sort()
  }

  async exists(path: string): Promise<boolean> {
    const p = within(path)
    try {
      await this.fs.readdir(p) // succeeds for a directory
      return true
    } catch {
      try {
        await this.fs.readFile(p) // succeeds for a file
        return true
      } catch {
        return false
      }
    }
  }
}

/**
 * One booted workspace running inside a WebContainer: an in-browser filesystem,
 * an in-browser Node runtime, and (optionally) a preview whose URL WebContainer
 * emits via `server-ready` when a dev server starts listening.
 */
export class WebContainerRunnerSession implements RunnerSession {
  readonly id: string
  readonly fs: WebContainerFs
  disposed = false

  readonly preview?: (opts?: PreviewOptions) => Promise<Preview>

  private readonly cwd: string
  private readonly env: Record<string, string>
  private readonly procs = new Set<RunnerProcess>()
  /** Preview URLs by port, kept current from `server-ready` / `port` events. */
  private readonly ports = new Map<number, string>()
  /** The most recently readied server, so `preview()` with no port returns it. */
  private lastReady?: { port: number; url: string }

  constructor(
    id: string,
    private readonly wc: WebContainerInstance,
    boot: BootOptions,
    preview: boolean,
  ) {
    this.id = id
    this.fs = new WebContainerFs(wc.fs)
    this.cwd = boot.cwd ? norm(boot.cwd) : ''
    this.env = { ...(boot.env ?? {}) }

    // Track preview URLs as servers come up and ports close.
    wc.on('server-ready', (port, url) => {
      this.ports.set(port, url)
      this.lastReady = { port, url }
    })
    wc.on('port', (port, type, url) => {
      if (type === 'open') this.ports.set(port, url)
      else this.ports.delete(port)
    })

    if (preview) {
      this.preview = async (previewOpts: PreviewOptions = {}): Promise<Preview> => {
        if (this.disposed) throw new RunnerError('preview on a disposed session')
        const deadline = Date.now() + (previewOpts.waitMs ?? 0)
        for (;;) {
          // A specific port, else the most recently readied server.
          if (previewOpts.port != null) {
            const url = this.ports.get(previewOpts.port)
            if (url) return { url, port: previewOpts.port }
          } else if (this.lastReady) {
            return { url: this.lastReady.url, port: this.lastReady.port }
          }
          if (Date.now() >= deadline) {
            throw new RunnerError(
              previewOpts.port != null
                ? `no server ready on port ${previewOpts.port}`
                : 'no server ready yet; start a dev server first (or pass a larger waitMs)',
            )
          }
          await delay(100)
        }
      }
    }
  }

  /** Build spawn options from the session defaults merged with per-command overrides. */
  private spawnOpts(opts: ExecOptions): SpawnOptions {
    const cwd = opts.cwd ?? (this.cwd || undefined)
    const env = { ...this.env, ...(opts.env ?? {}) }
    const o: SpawnOptions = { output: true }
    if (cwd) o.cwd = cwd
    if (Object.keys(env).length) o.env = env
    return o
  }

  /**
   * Drain a process's combined terminal output and resolve its result. The
   * output stream is a pseudoterminal that merges stdout and stderr, so
   * everything lands in `stdout` and `stderr` stays empty (a WebContainer trait,
   * not the shape LocalRunner/DockerRunner give). Enforces `timeoutMs` by killing
   * the process and returning exit code `124`, matching the other runners.
   */
  private async collect(proc: WebContainerProcess, timeoutMs?: number): Promise<ExecResult> {
    let stdout = ''
    const drained = proc.output
      .pipeTo(new WritableStream<string>({ write: chunk => void (stdout += chunk) }))
      .catch(() => {})

    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout =
      timeoutMs != null
        ? new Promise<number>(res => {
            timer = setTimeout(() => {
              timedOut = true
              proc.kill()
              res(124) // discarded; the timedOut branch below sets the real code
            }, timeoutMs)
          })
        : undefined

    const exitCode = await (timeout ? Promise.race([proc.exit, timeout]) : proc.exit)
    if (timer) clearTimeout(timer)
    await drained

    if (timedOut) {
      return { stdout, stderr: `[ai-autopilot] command timed out after ${timeoutMs}ms`, exitCode: 124 }
    }
    return { stdout, stderr: '', exitCode }
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this.disposed) throw new RunnerError('exec on a disposed session')
    // `jsh -c` runs an arbitrary command string, mirroring `sh -c` on the other runners.
    const proc = await this.wc.spawn('jsh', ['-c', command], this.spawnOpts(opts))
    return await this.collect(proc, opts.timeoutMs)
  }

  /**
   * Start a long-running command in the background and return a handle at once,
   * without waiting for it to exit — the caller serves a {@link preview} against it.
   */
  async start(command: string, opts: ExecOptions = {}): Promise<RunnerProcess> {
    if (this.disposed) throw new RunnerError('start on a disposed session')
    const proc = await this.wc.spawn('jsh', ['-c', command], this.spawnOpts(opts))
    let stdout = ''
    proc.output.pipeTo(new WritableStream<string>({ write: chunk => void (stdout += chunk) })).catch(() => {})

    const exit = proc.exit.then((exitCode): ExecResult => ({ stdout, stderr: '', exitCode }))
    const handle: RunnerProcess = {
      command,
      exit,
      stop: async () => {
        try {
          proc.kill()
        } catch {
          // already gone
        }
        await exit.catch(() => {})
        this.procs.delete(handle)
      },
    }
    exit.then(() => this.procs.delete(handle)).catch(() => {})
    this.procs.add(handle)
    return handle
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.procs].map(p => p.stop().catch(() => {})))
    try {
      this.wc.teardown()
    } catch {
      // already torn down
    }
    if (live === this) live = null
  }
}

export interface WebContainerRunnerOptions {
  /**
   * The COEP header WebContainer boots under. Must match the header the hosting
   * page is served with. Default `require-corp`. See the WebContainer docs on
   * configuring headers.
   */
  coep?: 'require-corp' | 'credentialless' | 'none'
  /** Cosmetic folder name for the working directory. Auto-generated when omitted. */
  workdirName?: string
  /** Whether booted sessions expose a `preview`. Default `true`. */
  preview?: boolean
}

/**
 * A {@link Runner} that boots each workspace as a WebContainer — StackBlitz's
 * in-browser Node runtime (`@webcontainer/api`). The sandboxed, zero-server
 * counterpart to {@link DockerRunner}: untrusted, agent-authored code runs
 * entirely inside the user's browser tab, with an instant preview URL for a Vike
 * dev server, and nothing touches the host.
 *
 * **Browser only.** WebContainer needs `SharedArrayBuffer`, so the hosting page
 * must be cross-origin isolated (COOP `same-origin` + COEP `require-corp`), and
 * `@webcontainer/api` must be provided by the app's bundler — this package
 * imports it lazily (dynamic `import`) so merely loading `@gemstack/ai-autopilot`
 * in Node never pulls it in. Guard with {@link webContainerAvailable} and reach
 * for {@link DockerRunner} on the server. Boot-and-serve is proven end-to-end by
 * the headless-Chromium harness under `harness/webcontainer/`.
 *
 * Only one WebContainer exists per page, so only one session is live at a time;
 * `boot()` throws if a previous session has not been disposed.
 *
 * ```ts
 * if (!webContainerAvailable()) return // not cross-origin isolated
 * const runner = new WebContainerRunner()
 * const s = await runner.boot({ files: { 'server.js': "require('http').createServer((_,r)=>r.end('hi')).listen(3000)" } })
 * await s.exec('node -v')                            // one-shot in the browser runtime
 *
 * const dev = await s.start('npm run dev')           // long-running, returns at once
 * const { url } = await s.preview({ port: 3000, waitMs: 10000 }) // WebContainer preview URL, once ready
 * await dev.stop()
 * await s.dispose()                                  // teardown() — frees the single WebContainer slot
 * ```
 */
export class WebContainerRunner implements Runner {
  readonly kind = 'webcontainer'

  private readonly opts: Required<WebContainerRunnerOptions>

  constructor(options: WebContainerRunnerOptions = {}) {
    this.opts = {
      coep: options.coep ?? 'require-corp',
      workdirName: options.workdirName ?? '',
      preview: options.preview ?? true,
    }
  }

  async boot(opts: BootOptions = {}): Promise<WebContainerRunnerSession> {
    if (!webContainerAvailable()) {
      throw new RunnerError(
        'WebContainer needs a cross-origin isolated browser context (COOP/COEP); it cannot boot in Node',
      )
    }
    if (live && !live.disposed) {
      throw new RunnerError('a WebContainer session is already live; dispose it before booting another')
    }
    const { WebContainer } = await import('@webcontainer/api')
    const bootOpts: { coep: 'require-corp' | 'credentialless' | 'none'; workdirName?: string } = { coep: this.opts.coep }
    if (this.opts.workdirName) bootOpts.workdirName = this.opts.workdirName
    const wc = await WebContainer.boot(bootOpts)
    try {
      const id = wc.workdir.split('/').pop() || wc.workdir
      const session = new WebContainerRunnerSession(id, wc, opts, this.opts.preview)
      live = session
      for (const [path, contents] of Object.entries(opts.files ?? {})) {
        await session.fs.write(path, contents)
      }
      return session
    } catch (err) {
      try {
        wc.teardown()
      } catch {
        // ignore
      }
      live = null
      throw err
    }
  }
}
