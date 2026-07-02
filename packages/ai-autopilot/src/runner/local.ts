import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative, sep } from 'node:path'
import type {
  Runner,
  RunnerSession,
  RunnerFs,
  BootOptions,
  ExecOptions,
  ExecResult,
  Preview,
  PreviewOptions,
} from './types.js'
import { RunnerError } from './types.js'

export interface LocalRunnerOptions {
  /** Base directory to create workspaces under. Default: the OS temp dir. */
  root?: string
  /** Whether booted sessions expose a `preview`. Default `true`. */
  preview?: boolean
  /** Origin returned by `preview()`, joined with the port. Default `http://localhost`. */
  previewHost?: string
}

/** Normalize a workspace path to a canonical relative form (matches FakeFs). */
function norm(path: string): string {
  return path.replace(/^\.?\/+/, '').replace(/\/+$/, '')
}

/** Resolve `path` inside `root`, rejecting anything that escapes the workspace. */
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

  constructor(
    id: string,
    root: string,
    boot: BootOptions,
    opts: Required<Pick<LocalRunnerOptions, 'preview' | 'previewHost'>>,
  ) {
    this.id = id
    this.root = root
    this.fs = new LocalFs(root)
    this.cwd = boot.cwd ? norm(boot.cwd) : ''
    this.env = { ...(boot.env ?? {}) }
    if (opts.preview) {
      this.preview = async (previewOpts: PreviewOptions = {}): Promise<Preview> => {
        if (this.disposed) throw new RunnerError('preview on a disposed session')
        const port = previewOpts.port ?? 3000
        return { url: `${opts.previewHost}:${port}`, port }
      }
    }
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this.disposed) throw new RunnerError('exec on a disposed session')
    const cwd = within(this.root, opts.cwd ?? (this.cwd || '.'))
    const env = { ...process.env, ...this.env, ...(opts.env ?? {}) }
    return await new Promise<ExecResult>((resolvePromise, reject) => {
      const child = spawn(command, { cwd, env, shell: true })
      let stdout = ''
      let stderr = ''
      let timedOut = false
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
          resolvePromise({
            stdout,
            stderr: stderr + `\n[ai-autopilot] command timed out after ${opts.timeoutMs}ms`,
            exitCode: 124,
          })
          return
        }
        resolvePromise({ stdout, stderr, exitCode: code ?? (signal ? 137 : 1) })
      })
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await rm(this.root, { recursive: true, force: true })
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
 * await s.exec('node app.js') // → { stdout: 'hi\n', stderr: '', exitCode: 0 }
 * await s.dispose()           // removes the temp workspace
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
}
