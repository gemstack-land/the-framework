import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { FileTree } from '@gemstack/ai-autopilot'

/**
 * Directory names never copied into a sandbox: build output, VCS, and caches. The
 * sandbox installs its own deps, so `node_modules` is copied by nobody — it is
 * rebuilt inside the container from the seeded `package.json`.
 */
export const SANDBOX_IGNORE: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  'coverage',
  '.the-framework',
])

/** Options for {@link snapshotWorkspace}. */
export interface SnapshotOptions {
  /** Directory names to skip. Default {@link SANDBOX_IGNORE}. */
  ignore?: ReadonlySet<string>
  /** Skip files larger than this many bytes (default 1 MiB) — assets belong in the repo, not the sandbox seed. */
  maxFileBytes?: number
}

/**
 * Read a host workspace into a Runner {@link FileTree} (relative path → contents),
 * so a fresh sandbox container can be seeded with just the source the driver wrote.
 * This is the Docker analog of `LocalRunner.adopt`: Local adopts the host dir in
 * place, Docker cannot, so we copy the source in.
 *
 * Text only, and deliberately shallow on cost: build/VCS/cache dirs are skipped,
 * oversized files are skipped, and a file containing a NUL byte is treated as
 * binary and skipped (its absence does not stop the app from booting for a health
 * check). This is a first-slice serve-verification seed, not a faithful mirror.
 */
export async function snapshotWorkspace(dir: string, opts: SnapshotOptions = {}): Promise<FileTree> {
  const ignore = opts.ignore ?? SANDBOX_IGNORE
  const maxBytes = opts.maxFileBytes ?? 1024 * 1024
  const tree: FileTree = {}

  async function walk(abs: string): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true })
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue
      const child = join(abs, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      if (!entry.isFile()) continue // skip symlinks, sockets, devices
      // Check the size before reading, so a huge asset is skipped without ever
      // loading it into memory.
      const st = await stat(child)
      if (st.size > maxBytes) continue
      const buf = await readFile(child)
      if (buf.includes(0)) continue // binary
      // Always use POSIX separators: the key is a path inside a Linux container.
      tree[relative(dir, child).split(sep).join('/')] = buf.toString('utf8')
    }
  }

  await walk(dir)
  return tree
}
