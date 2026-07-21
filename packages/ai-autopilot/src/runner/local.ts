import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative, sep } from 'node:path'
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
import { norm } from './path.js'

const delay = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms))

/** Resolve once something is accepting TCP connections on `host:port`, or after `timeoutMs`. */
async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ok = await new Promise<boolean>(res => {
      const socket = connect({ host, port }, () => {
        socket.destroy()
        res(true)
      })
      socket.on('error', () => {
        socket.destroy()
        res(false)
      })
    })
    if (ok || Date.now() >= deadline) return
    await delay(100)
  }
}

export interface LocalRunnerOptions {
  /** Base directory to create workspaces under. Default: the OS temp dir. */
  root?: string
  /** Whether booted sessions expose a `preview`. Default `true`. */
  preview?: boolean
  /** Origin returned by `preview()`, joined with the port. Default `http://localhost`. */
  previewHost?: string
}

/**
 * Resolve `path` inside `root`, rejecting anything that escapes the workspace.
 *
 * Not {@link safeSegments}: there is a real filesystem here, so resolving against
 * the root and asking `node:path` whether we stayed inside also catches what the
 * host resolves differently. The container and browser runners have no such root.
 */
function within(root: string, path: string): string {
  const abs = resolve(root, norm(path))
  const rel = relative(root, abs)
  if (rel === '..' || rel.startsWith('..' + sep)) {
    throw new RunnerError(`path escapes the workspace: ${path}`)
  }
  return abs
}

class LocalFs implements RunnerFs {
  constructor(private readonly root: string) {}

  async read(path: string): Promise<string> {
    try {
      return await readFile(within(this.root, path), 'utf8')
    } catch (err) {
      if (err instanceof RunnerError) throw err
      throw new RunnerError(`no such file: ${path}`)
    }
  }

  async write(path: string, contents: string): Promise<void> {
    const abs = within(this.root, path)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents)
  }

  async remove(path: string): Promise<void> {
    await rm(within(this.root, path), { recursive: true, force: true })
  }

  async list(dir?: string): Promise<string[]> {
    const base = dir ? within(this.root, dir) : this.root
    const out: string[] = []
    const walk = async (abs: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(abs, { withFileTypes: true })
      } catch {
        return // missing dir → empty, mirroring the fake's prefix filter
      }
      for (const e of entries) {
        const child = join(abs, e.name)
        if (e.isDirectory()) await walk(child)
        else out.push(relative(this.root, child).split(sep).join('/'))
      }
    }
    await walk(base)
    return out.sort()
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(within(this.root, path))
      return true
    } catch {
      return false
    }
  }
}

/**
 * A {@link RunnerSession} backed by a real directory on the host: a real
 * filesystem, real child processes, and (optionally) a localhost preview.
 */
export class LocalRunnerSession implements RunnerSession {
  readonly id: string
  readonly fs: LocalFs
  /** The absolute workspace directory on disk. */
  readonly root: string
  disposed = false

  readonly preview?: (opts?: PreviewOptions) => Promise<Preview>

  private readonly cwd: string
  private readonly env: Record<string, string>
  /** Long-running processes started with {@link start}, so `dispose` can stop them. */
  private readonly procs = new Set<RunnerProcess>()

  /** When true, `dispose` leaves the workspace on disk (an adopted directory). */
  private readonly keep: boolean

  constructor(
    id: string,
    root: string,
    boot: BootOptions,
    opts: Required<Pick<LocalRunnerOptions, 'preview' | 'previewHost'>>,
    keep = false,
  ) {
    this.id = id
    this.root = root
    this.keep = keep
    this.fs = new LocalFs(root)
    this.cwd = boot.cwd ? norm(boot.cwd) : ''
    this.env = { ...(boot.env ?? {}) }
    if (opts.preview) {
      this.preview = async (previewOpts: PreviewOptions = {}): Promise<Preview> => {
        if (this.disposed) throw new RunnerError('preview on a disposed session')
        const port = previewOpts.port ?? 3000
        // Wait for the started server to accept connections, so the URL is live on return.
        if (previewOpts.waitMs && previewOpts.waitMs > 0) await waitForPort('127.0.0.1', port, previewOpts.waitMs)
        return { url: `${opts.previewHost}:${port}`, port }
      }
    }
  }

  /**
   * Start a long-running command in the background. Spawns it in its own process
   * group (`detached`) so `stop` can kill the whole tree (the shell AND the server
   * it launched), and returns immediately with a handle — it does NOT await exit.
   */
  async start(command: string, opts: ExecOptions = {}): Promise<RunnerProcess> {
    if (this.disposed) throw new RunnerError('start on a disposed session')
    const cwd = within(this.root, opts.cwd ?? (this.cwd || '.'))
    const env = { ...process.env, ...this.env, ...(opts.env ?? {}) }
    const child = spawn(command, { cwd, env, shell: true, detached: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', d => (stdout += d))
    child.stderr?.on('data', d => (stderr += d))

    let resolveExit!: (r: ExecResult) => void
    const exit = new Promise<ExecResult>(res => (resolveExit = res))
    let settled = false
    const settle = (r: ExecResult): void => {
      if (settled) return
      settled = true
      resolveExit(r)
    }
    child.on('close', (code, signal) => settle({ stdout, stderr, exitCode: code ?? (signal ? 137 : 0) }))
    child.on('error', err => settle({ stdout, stderr: stderr + `\n[ai-autopilot] failed to spawn: ${(err as Error).message}`, exitCode: 1 }))

    // Kill the whole process group (negative pid), escalating SIGTERM → SIGKILL.
    const signal = (sig: NodeJS.Signals): void => {
      if (settled || child.pid == null) return
      try {
        process.kill(-child.pid, sig)
      } catch {
        // group gone already
      }
    }
    const proc: RunnerProcess = {
      command,
      exit,
      stop: async () => {
        if (!settled) {
          signal('SIGTERM')
          const raced = await Promise.race([exit, delay(2000).then(() => 'timeout' as const)])
          if (raced === 'timeout') signal('SIGKILL')
          await exit
        }
        this.procs.delete(proc)
      },
    }
    exit.then(() => this.procs.delete(proc))
    this.procs.add(proc)
    return proc
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this.disposed) throw new RunnerError('exec on a disposed session')
    const cwd = within(this.root, opts.cwd ?? (this.cwd || '.'))
    const env = { ...process.env, ...this.env, ...(opts.env ?? {}) }
    return await new Promise<ExecResult>((resolvePromise, reject) => {
      // Own process group (like `start`) so a timeout kills the whole tree. A
      // plain kill only reaps the `sh` wrapper; a surviving grandchild keeps the
      // inherited stdio open, `close` never fires, and the timeout never lands.
      const child = spawn(command, { cwd, env, shell: true, detached: true })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      let reaper: NodeJS.Timeout | undefined

      const finish = (result: ExecResult): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (reaper) clearTimeout(reaper)
        resolvePromise(result)
      }
      const timedOutResult = (): ExecResult => ({
        stdout,
        stderr: stderr + `\n[ai-autopilot] command timed out after ${opts.timeoutMs}ms`,
        exitCode: 124,
      })
      const killTree = (): void => {
        if (child.pid == null) return
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL') // group already gone, or no group to speak of
        }
      }

      const timer =
        opts.timeoutMs != null
          ? setTimeout(() => {
              timedOut = true
              killTree()
              // A detached grandchild can still hold the pipes open, so don't
              // wait on `close` forever — settle shortly after the kill.
              reaper = setTimeout(() => finish(timedOutResult()), 250)
              reaper.unref?.()
            }, opts.timeoutMs)
          : undefined
      child.stdout?.on('data', d => (stdout += d))
      child.stderr?.on('data', d => (stderr += d))
      child.on('error', err => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (reaper) clearTimeout(reaper)
        reject(new RunnerError(`failed to spawn: ${(err as Error).message}`))
      })
      child.on('close', (code, signal) => {
        finish(
          timedOut ? timedOutResult() : { stdout, stderr, exitCode: code ?? (signal ? 137 : 1) },
        )
      })
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // Stop any still-running background processes before removing the workspace.
    await Promise.all([...this.procs].map(p => p.stop().catch(() => {})))
    // An adopted workspace is not ours to delete; only remove one we created.
    if (!this.keep) await rm(this.root, { recursive: true, force: true })
  }
}

/**
 * A {@link Runner} that boots each workspace as a real temp directory on the
 * host — real files (`node:fs`), real commands (`child_process` with a shell),
 * and a localhost `preview`. The first *real* adapter behind the runner seam,
 * and the reference the sandboxed ones (WebContainer, Docker, Flue) mirror.
 *
 * It runs commands **unsandboxed on the host**, so use it only where execution
 * is already trusted — local dev or a CI job that is itself the sandbox — not
 * to run untrusted, agent-authored code. Reach for a sandboxed runner there.
 *
 * ```ts
 * const runner = new LocalRunner()
 * const s = await runner.boot({ files: { 'app.js': "console.log('hi')" } })
 * await s.exec('node app.js')            // one-shot → { stdout: 'hi\n', … }
 *
 * const dev = await s.start('npm run dev')          // long-running, returns at once
 * const { url } = await s.preview({ port: 3000, waitMs: 5000 }) // waits until reachable
 * await dev.stop()                                   // kills the server (process group)
 * await s.dispose()                                  // stops leftovers + removes the workspace
 * ```
 */
export class LocalRunner implements Runner {
  readonly kind = 'local'

  private readonly base: string
  private readonly opts: Required<Pick<LocalRunnerOptions, 'preview' | 'previewHost'>>

  constructor(options: LocalRunnerOptions = {}) {
    this.base = options.root ?? tmpdir()
    this.opts = {
      preview: options.preview ?? true,
      previewHost: options.previewHost ?? 'http://localhost',
    }
  }

  async boot(opts: BootOptions = {}): Promise<LocalRunnerSession> {
    await mkdir(this.base, { recursive: true })
    const root = await mkdtemp(join(this.base, 'ai-autopilot-'))
    for (const [path, contents] of Object.entries(opts.files ?? {})) {
      const abs = within(root, path)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, contents)
    }
    return new LocalRunnerSession(root.split(sep).pop()!, root, opts, this.opts)
  }

  /**
   * Adopt an **existing** directory as the workspace instead of creating a fresh
   * temp one. The returned session reads, runs, starts, and previews inside
   * `dir` exactly like a booted one, but `dispose` does NOT delete it, since the
   * directory belongs to the caller. Use this to run or verify code that already
   * lives on disk, e.g. an app another tool (a wrapped coding agent) just wrote.
   */
  async adopt(dir: string, opts: BootOptions = {}): Promise<LocalRunnerSession> {
    const root = resolve(dir)
    await mkdir(root, { recursive: true })
    for (const [path, contents] of Object.entries(opts.files ?? {})) {
      const abs = within(root, path)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, contents)
    }
    return new LocalRunnerSession(root.split(sep).pop() || root, root, opts, this.opts, true)
  }
}
