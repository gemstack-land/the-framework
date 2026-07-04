import { spawn } from 'node:child_process'
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

/** The workspace root inside every container. */
const WORKSPACE = '/workspace'

/** A monotonic counter so container names stay unique within a process. */
let seq = 0

/**
 * Run the `docker` CLI once (no shell), capturing its output. `input`, when
 * given, is piped to the process's stdin. Rejects only when the binary itself
 * can't be spawned — a non-zero exit is returned in {@link ExecResult}.
 */
function docker(args: string[], input?: string): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', d => (stdout += d))
    child.stderr?.on('data', d => (stderr += d))
    child.on('error', err => reject(new RunnerError(`docker CLI unavailable: ${(err as Error).message}`)))
    child.on('close', code => resolvePromise({ stdout, stderr, exitCode: code ?? 1 }))
    child.stdin?.end(input ?? '')
  })
}

/** True when a Docker daemon is reachable — lets callers/tests skip when it isn't. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    return (await docker(['info'])).exitCode === 0
  } catch {
    return false
  }
}

/**
 * Resolve once the server inside the container is accepting connections on
 * `port`, or after `timeoutMs`. The probe runs *inside* the container on purpose:
 * Docker Desktop's host-side port proxy pre-binds the published port, so a
 * host-side TCP connect succeeds before the real server is up — a false ready.
 * Probing from inside (no proxy) reflects the actual listener.
 */
async function waitForContainerPort(container: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const probe = `require('net').connect(${port},'127.0.0.1',function(){process.exit(0)}).on('error',function(){process.exit(1)})`
  for (;;) {
    const r = await docker(['exec', container, 'node', '-e', probe]).catch(() => ({ exitCode: 1 }) as ExecResult)
    if (r.exitCode === 0 || Date.now() >= deadline) return
    await delay(100)
  }
}

/** Normalize a workspace path to a canonical relative form (matches LocalFs/FakeFs). */
function norm(path: string): string {
  return path.replace(/^\.?\/+/, '').replace(/\/+$/, '')
}

/** Resolve `path` to an absolute container path under {@link WORKSPACE}, rejecting escapes. */
function within(path: string): string {
  const parts: string[] = []
  for (const seg of norm(path).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) throw new RunnerError(`path escapes the workspace: ${path}`)
      parts.pop()
    } else parts.push(seg)
  }
  return parts.length ? `${WORKSPACE}/${parts.join('/')}` : WORKSPACE
}

/** Flatten an env map into repeated `-e KEY=VALUE` docker flags. */
function envFlags(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
}

export interface DockerRunnerOptions {
  /** Base image each workspace boots from. Default `node:20-alpine`. */
  image?: string
  /** Whether booted sessions expose a `preview`. Default `true`. */
  preview?: boolean
  /**
   * The in-container port `preview` publishes. Fixed at boot because Docker maps
   * ports when the container starts. Default `3000` (autopilot's serve default).
   */
  previewPort?: number
  /** Origin returned by `preview()`, joined with the mapped host port. Default `http://localhost`. */
  previewHost?: string
}

type ResolvedOptions = Required<Omit<DockerRunnerOptions, 'image'>>

/** A {@link RunnerFs} backed by a container's filesystem, driven through `docker exec`. */
class DockerFs implements RunnerFs {
  constructor(private readonly container: string) {}

  async read(path: string): Promise<string> {
    const r = await docker(['exec', this.container, 'cat', within(path)])
    if (r.exitCode !== 0) throw new RunnerError(`no such file: ${path}`)
    return r.stdout
  }

  async write(path: string, contents: string): Promise<void> {
    // Pass the path as $0 so it can never be interpreted as shell; mkdir -p its parent, then take stdin.
    const r = await docker(
      ['exec', '-i', this.container, 'sh', '-c', 'mkdir -p "$(dirname "$0")" && cat > "$0"', within(path)],
      contents,
    )
    if (r.exitCode !== 0) throw new RunnerError(`write failed: ${path}: ${r.stderr.trim()}`)
  }

  async remove(path: string): Promise<void> {
    await docker(['exec', this.container, 'rm', '-rf', within(path)])
  }

  async list(dir?: string): Promise<string[]> {
    const base = dir ? within(dir) : WORKSPACE
    const r = await docker(['exec', this.container, 'find', base, '-type', 'f'])
    if (r.exitCode !== 0) return [] // missing dir → empty, mirroring LocalFs
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map(p => p.slice(WORKSPACE.length + 1)) // strip the '/workspace/' prefix
      .sort()
  }

  async exists(path: string): Promise<boolean> {
    return (await docker(['exec', this.container, 'test', '-e', within(path)])).exitCode === 0
  }
}

/**
 * One booted workspace running inside a container: a real filesystem, a real
 * shell, and (optionally) a preview whose host port Docker assigned at boot.
 */
export class DockerRunnerSession implements RunnerSession {
  readonly id: string
  readonly fs: DockerFs
  /** The container's name — also its handle for `docker exec`/`rm`. */
  readonly container: string
  disposed = false

  readonly preview?: (opts?: PreviewOptions) => Promise<Preview>

  private readonly cwd: string
  private readonly env: Record<string, string>
  private readonly procs = new Set<RunnerProcess>()
  /** Distinguishes background processes so `stop` can target the right one. */
  private startSeq = 0

  constructor(id: string, container: string, boot: BootOptions, opts: ResolvedOptions) {
    this.id = id
    this.container = container
    this.fs = new DockerFs(container)
    this.cwd = boot.cwd ? norm(boot.cwd) : ''
    this.env = { ...(boot.env ?? {}) }
    if (opts.preview) {
      this.preview = async (previewOpts: PreviewOptions = {}): Promise<Preview> => {
        if (this.disposed) throw new RunnerError('preview on a disposed session')
        const wanted = previewOpts.port ?? opts.previewPort
        if (wanted !== opts.previewPort) {
          throw new RunnerError(
            `preview port ${wanted} was not published at boot; construct DockerRunner({ previewPort: ${wanted} })`,
          )
        }
        // Docker assigned an ephemeral host port at boot; ask which one, then hand back the reachable URL.
        const r = await docker(['port', this.container, `${opts.previewPort}/tcp`])
        const mapping = r.stdout.split('\n').map(s => s.trim()).filter(Boolean)[0]
        if (!mapping) throw new RunnerError(`no published host port for ${opts.previewPort}`)
        const hostPort = Number(mapping.slice(mapping.lastIndexOf(':') + 1))
        // Probe the container port, not the host port — the host proxy pre-binds and lies about readiness.
        if (previewOpts.waitMs && previewOpts.waitMs > 0) await waitForContainerPort(this.container, opts.previewPort, previewOpts.waitMs)
        return { url: `${opts.previewHost}:${hostPort}`, port: hostPort }
      }
    }
  }

  private args(command: string, opts: ExecOptions, flags: string[] = []): string[] {
    const cwd = within(opts.cwd ?? (this.cwd || '.'))
    const env = { ...this.env, ...(opts.env ?? {}) }
    return ['exec', ...flags, '-w', cwd, ...envFlags(env), this.container, 'sh', '-c', command]
  }

  /**
   * Start a long-running command in the background and return a handle at once.
   * The command records its own pid to a file (via `exec`, so the pid is the
   * command's, not the shell's) so `stop` can signal it; `dispose` force-removes
   * the container as a backstop for anything the signal misses.
   */
  async start(command: string, opts: ExecOptions = {}): Promise<RunnerProcess> {
    if (this.disposed) throw new RunnerError('start on a disposed session')
    const pidfile = `/tmp/ai-autopilot-start-${++this.startSeq}.pid`
    const child = spawn('docker', this.args(`echo $$ > ${pidfile}; exec ${command}`, opts))
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

    // Signal the recorded in-container pid; ignore failures (already gone / container removed).
    const killInside = (sig: string): Promise<unknown> =>
      docker(['exec', this.container, 'sh', '-c', `kill -${sig} "$(cat ${pidfile} 2>/dev/null)" 2>/dev/null; true`]).catch(() => {})

    const proc: RunnerProcess = {
      command,
      exit,
      stop: async () => {
        if (!settled) {
          await killInside('TERM')
          const raced = await Promise.race([exit, delay(2000).then(() => 'timeout' as const)])
          if (raced === 'timeout') await killInside('KILL')
          child.kill('SIGKILL') // drop the host-side exec client too
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
    return await new Promise<ExecResult>((resolvePromise, reject) => {
      const child = spawn('docker', this.args(command, opts))
      let stdout = ''
      let stderr = ''
      let timedOut = false
      // Enforce the timeout host-side (like LocalRunner); dispose reaps any in-container remnant.
      const timer =
        opts.timeoutMs != null
          ? setTimeout(() => {
              timedOut = true
              child.kill('SIGKILL')
            }, opts.timeoutMs)
          : undefined
      child.stdout?.on('data', d => (stdout += d))
      child.stderr?.on('data', d => (stderr += d))
      child.on('error', err => {
        if (timer) clearTimeout(timer)
        reject(new RunnerError(`failed to spawn: ${(err as Error).message}`))
      })
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer)
        if (timedOut) {
          resolvePromise({ stdout, stderr: stderr + `\n[ai-autopilot] command timed out after ${opts.timeoutMs}ms`, exitCode: 124 })
          return
        }
        // docker exec propagates the in-container exit code as its own.
        resolvePromise({ stdout, stderr, exitCode: code ?? (signal ? 137 : 1) })
      })
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.procs].map(p => p.stop().catch(() => {})))
    await docker(['rm', '-f', this.container]).catch(() => {})
  }
}

/**
 * A {@link Runner} that boots each workspace as a container via the `docker` CLI
 * — the sandboxed counterpart to {@link LocalRunner}. Untrusted, agent-authored
 * code runs isolated from the host: its own filesystem, process space, and
 * (with `preview`) a published port mapped to an ephemeral host port.
 *
 * Requires a running Docker daemon and the `docker` CLI on `PATH`; it shells out
 * to them and pulls no npm dependency. The base image needs a POSIX shell plus
 * `node`/`npm` — the default `node:20-alpine` has both.
 *
 * ```ts
 * const runner = new DockerRunner()
 * const s = await runner.boot({ files: { 'app.js': "console.log('hi')" } })
 * await s.exec('node app.js')                       // one-shot inside the container
 *
 * const dev = await s.start('npm run dev')          // long-running, returns at once
 * const { url } = await s.preview({ port: 3000, waitMs: 8000 }) // mapped host URL, once reachable
 * await dev.stop()
 * await s.dispose()                                 // docker rm -f — stops everything, frees the port
 * ```
 *
 * The dev server must bind `0.0.0.0` inside the container (not `127.0.0.1`), or
 * Docker's published port can't reach it from the host.
 */
export class DockerRunner implements Runner {
  readonly kind = 'docker'

  private readonly image: string
  private readonly opts: ResolvedOptions

  constructor(options: DockerRunnerOptions = {}) {
    this.image = options.image ?? 'node:20-alpine'
    this.opts = {
      preview: options.preview ?? true,
      previewPort: options.previewPort ?? 3000,
      previewHost: options.previewHost ?? 'http://localhost',
    }
  }

  async boot(opts: BootOptions = {}): Promise<DockerRunnerSession> {
    const id = `${Date.now().toString(36)}-${++seq}`
    const name = `ai-autopilot-${id}`
    // Publish the preview port to an ephemeral host port on localhost; keep the container alive to exec into.
    const publish = this.opts.preview ? ['-p', `127.0.0.1:0:${this.opts.previewPort}`] : []
    const run = await docker(['run', '-d', '--name', name, '-w', WORKSPACE, ...publish, this.image, 'tail', '-f', '/dev/null'])
    if (run.exitCode !== 0) {
      throw new RunnerError(`failed to boot container: ${run.stderr.trim() || run.stdout.trim()}`)
    }
    try {
      const session = new DockerRunnerSession(id, name, opts, this.opts)
      for (const [path, contents] of Object.entries(opts.files ?? {})) {
        await session.fs.write(path, contents)
      }
      return session
    } catch (err) {
      await docker(['rm', '-f', name]).catch(() => {})
      throw err
    }
  }
}
