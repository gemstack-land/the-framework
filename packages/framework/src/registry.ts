import { basename, dirname, join, resolve } from 'node:path'

/**
 * The multi-project registry (#390): the list of projects the user has
 * installed The Framework into, kept as a single JSON file `.bashrc`-style —
 * `$HOME/.the-framework.json` — so it is the user's responsibility to re-create
 * per machine. Stores only `{id, path, addedAt}` per project; the daemon and
 * UI over it are separate concerns.
 */

/** One registered project. */
export interface ProjectRecord {
  /** Stable, URL-safe id derived from the path. */
  id: string
  /** Absolute repo path. */
  path: string
  /** ISO timestamp the project was added. */
  addedAt: string
}

/** The registry file name: a single file under `$XDG_CONFIG_HOME` (dotted under `$HOME`). */
export const REGISTRY_FILE = 'the-framework.json'

/**
 * Deterministic, URL-safe id for a project path: the sanitized basename plus a
 * short hash of the full path, so two repos named alike still get distinct ids.
 * Pure; same path always yields the same id.
 */
export function projectId(path: string): string {
  // djb2, rendered as base36: short, stable, URL-safe. Not cryptographic.
  let hash = 5381
  for (let i = 0; i < path.length; i++) {
    hash = ((hash * 33) ^ path.charCodeAt(i)) >>> 0
  }
  const name = basename(path)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
  return `${name}-${hash.toString(36)}`
}

/**
 * The registry file path, resolved from `env` (injectable so tests never touch
 * the real home): `$XDG_CONFIG_HOME/the-framework.json` when set, else the
 * dotted `$HOME/.the-framework.json`. A single file, not a directory (#390).
 */
export function registryPath(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, REGISTRY_FILE)
  return join(env.HOME ?? '', '.' + REGISTRY_FILE)
}

/** Minimal fs seam so the registry is unit-testable without touching disk. */
export interface RegistryFs {
  /** Rejects when the file is absent. */
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  /** Recursive; used on the registry file's parent dir. */
  mkdir(path: string): Promise<void>
}

/**
 * A {@link RegistryFs} backed by `node:fs/promises`. The import is dynamic so
 * the module core stays free of a hard `node:fs` dependency, same convention
 * as {@link nodeProjectFs}.
 */
export function nodeRegistryFs(): RegistryFs {
  return {
    async read(path) {
      const { readFile } = await import('node:fs/promises')
      return readFile(path, 'utf8')
    },
    async write(path, contents) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, contents, 'utf8')
    },
    async mkdir(path) {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(path, { recursive: true })
    },
  }
}

/** True when `value` is a well-formed {@link ProjectRecord}. */
function isRecord(value: unknown): value is ProjectRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.path === 'string' && typeof record.addedAt === 'string'
}

/**
 * Read the registry. Forgiving: a missing / unreadable / malformed / non-array
 * file yields `[]`, never throws. Deduped by resolved path, first wins.
 */
export async function listProjects(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.read(registryPath(env)))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const projects: ProjectRecord[] = []
  for (const value of parsed) {
    if (!isRecord(value)) continue
    const key = resolve(value.path)
    if (seen.has(key)) continue
    seen.add(key)
    projects.push(value)
  }
  return projects
}

/**
 * Register a project. Idempotent by resolved path: when the path is already
 * registered, the existing record is returned untouched (addedAt survives);
 * otherwise the new record is appended and the file written back.
 */
export async function addProject(
  path: string,
  addedAt: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord> {
  const absolute = resolve(path)
  const projects = await listProjects(fs, env)
  const existing = projects.find(project => resolve(project.path) === absolute)
  if (existing) return existing

  const record: ProjectRecord = { id: projectId(absolute), path: absolute, addedAt }
  projects.push(record)
  const file = registryPath(env)
  await fs.mkdir(dirname(file))
  await fs.write(file, JSON.stringify(projects, null, 2))
  return record
}

/**
 * Drop the project whose id matches and write the list back. Returns whether a
 * record was removed; an empty/missing registry is a no-write `false`.
 */
export async function removeProject(
  id: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const projects = await listProjects(fs, env)
  const remaining = projects.filter(project => project.id !== id)
  if (remaining.length === projects.length) return false
  await fs.write(registryPath(env), JSON.stringify(remaining, null, 2))
  return true
}
