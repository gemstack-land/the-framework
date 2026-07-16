import { basename, dirname, join, resolve } from 'node:path'
import { DEFAULT_CONSUMPTION_LIMITS, type ConsumptionLimit, type ConsumptionLimits } from './consumption.js'
import { nodeFs } from './node-fs.js'

/**
 * The multi-project registry (#390): the list of projects the user has
 * installed The Framework into, kept as a single JSON file `.bashrc`-style —
 * `$HOME/.the-framework.json` — so it is the user's responsibility to re-create
 * per machine. The same file also holds the user's dashboard preferences (#410),
 * so the daemon owns one user file and the UI never needs localStorage.
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

/**
 * The dashboard's Global options (#410), persisted next to the project list so they
 * survive restarts without localStorage — the daemon reads/writes them, the SPA reads
 * them over Telefunc. Flat booleans mirroring the Start form's toggles; every field is
 * optional and absent means off (Autopilot still defaults on in the UI).
 */
export interface Preferences {
  autopilot?: boolean
  technical?: boolean
  vanilla?: boolean
  eco?: boolean
  ecoPlanning?: boolean
  ecoResearch?: boolean
  ecoMaintenance?: boolean
  /** On-before-mergeable prompt (#326): on setReadyForMerge(), queue the quality follow-ups as TODO entries. */
  onBeforeMergeableQuality?: boolean
  /** Give the agent a real browser via chrome-devtools-mcp during the run (#452); maps to `--browser`. */
  browser?: boolean
  /**
   * How much of the subscription The Framework may burn before it pauses itself
   * (#527, the settings behind #519).
   *
   * The only preference where **absent does not mean off**: the rest are flat
   * booleans a user opts into, but an unset limit should protect the account
   * rather than leave it unguarded, so absent means {@link DEFAULT_CONSUMPTION_LIMITS}.
   * Read it through {@link resolveConsumptionLimits} rather than directly.
   */
  consumptionLimits?: ConsumptionLimits
}

/**
 * The persisted registry file shape (#410): the project list plus the user preferences.
 * Older installs wrote a bare `ProjectRecord[]`; {@link readRegistry} still reads those and
 * the next write migrates the file to this object form.
 */
export interface Registry {
  projects: ProjectRecord[]
  preferences: Preferences
}

/** A read/write handle for the user preferences, threaded through the dashboard's Telefunc
 * context so a public host (the relay) can leave it unwired. */
export interface PreferencesStore {
  read(): Promise<Preferences>
  save(preferences: Preferences): Promise<void>
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

/** A {@link RegistryFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeRegistryFs(): RegistryFs {
  const { read, write, mkdir } = nodeFs()
  return { read, write, mkdir }
}

/** True when `value` is a well-formed {@link ProjectRecord}. */
function isRecord(value: unknown): value is ProjectRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.path === 'string' && typeof record.addedAt === 'string'
}

/** Keep well-formed records, deduped by resolved path (first wins). */
function dedupeProjects(values: unknown[]): ProjectRecord[] {
  const seen = new Set<string>()
  const projects: ProjectRecord[] = []
  for (const value of values) {
    if (!isRecord(value)) continue
    const key = resolve(value.path)
    if (seen.has(key)) continue
    seen.add(key)
    projects.push(value)
  }
  return projects
}

const PREFERENCE_KEYS = [
  'autopilot',
  'technical',
  'vanilla',
  'eco',
  'ecoPlanning',
  'ecoResearch',
  'ecoMaintenance',
  'onBeforeMergeableQuality',
  'browser',
] as const

const CONSUMPTION_LIMIT_KEYS = ['daily', 'fiveHour', 'session'] as const

/**
 * Read one limit out of a hand-edited or browser-supplied object.
 *
 * `undefined` for anything we can't trust, so the caller falls back to the
 * default rather than to an unguarded account. The percentage is clamped rather
 * than rejected: a plausible-but-out-of-range number is a slip, and honouring
 * the nearest legal value beats silently reverting to something else entirely.
 */
function sanitizeConsumptionLimit(value: unknown): ConsumptionLimit | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as Record<string, unknown>
  const percent = input['percent']
  if (typeof input['enabled'] !== 'boolean') return undefined
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined
  return { enabled: input['enabled'], percent: Math.min(100, Math.max(0, percent)) }
}

/** Read the three limits, falling back per-limit so one bad entry can't unguard the rest. */
function sanitizeConsumptionLimits(value: unknown): ConsumptionLimits | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as Record<string, unknown>
  const limits = {} as ConsumptionLimits
  let any = false
  for (const key of CONSUMPTION_LIMIT_KEYS) {
    const limit = sanitizeConsumptionLimit(input[key])
    if (limit) any = true
    limits[key] = limit ?? DEFAULT_CONSUMPTION_LIMITS[key]
  }
  return any ? limits : undefined
}

/** Keep only the known preference fields, so a hand-edited or browser-supplied
 * object never lands junk (or the wrong type) in the user's home file. */
function sanitizePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return {}
  const input = value as Record<string, unknown>
  const preferences: Preferences = {}
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] === 'boolean') preferences[key] = input[key] as boolean
  }
  const consumptionLimits = sanitizeConsumptionLimits(input['consumptionLimits'])
  if (consumptionLimits) preferences.consumptionLimits = consumptionLimits
  return preferences
}

/**
 * The limits in force: what the user set, with {@link DEFAULT_CONSUMPTION_LIMITS}
 * filling any gap.
 *
 * Absent means the defaults rather than "off", so a user who has never opened
 * the settings is still guarded (#519).
 */
export function resolveConsumptionLimits(preferences: Preferences | undefined): ConsumptionLimits {
  const set = preferences?.consumptionLimits
  if (!set) return DEFAULT_CONSUMPTION_LIMITS
  return {
    daily: set.daily ?? DEFAULT_CONSUMPTION_LIMITS.daily,
    fiveHour: set.fiveHour ?? DEFAULT_CONSUMPTION_LIMITS.fiveHour,
    session: set.session ?? DEFAULT_CONSUMPTION_LIMITS.session,
  }
}

/**
 * Read the whole registry. Forgiving: a missing / unreadable / malformed file yields an
 * empty registry, never throws. Accepts both the current object form and the legacy bare
 * `ProjectRecord[]` (pre-#410), so old installs keep working; projects are deduped by
 * resolved path and unknown preference fields are dropped.
 */
export async function readRegistry(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Registry> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.read(registryPath(env)))
  } catch {
    return { projects: [], preferences: {} }
  }
  // Legacy format: a bare array of project records. Migrated to the object form on next write.
  if (Array.isArray(parsed)) return { projects: dedupeProjects(parsed), preferences: {} }
  if (typeof parsed !== 'object' || parsed === null) return { projects: [], preferences: {} }
  const obj = parsed as Record<string, unknown>
  const projects = Array.isArray(obj.projects) ? dedupeProjects(obj.projects) : []
  return { projects, preferences: sanitizePreferences(obj.preferences) }
}

/** Write the registry back as pretty object-form JSON, creating the parent dir. */
async function writeRegistry(registry: Registry, fs: RegistryFs, env: NodeJS.ProcessEnv): Promise<void> {
  const file = registryPath(env)
  await fs.mkdir(dirname(file))
  await fs.write(file, JSON.stringify(registry, null, 2))
}

/**
 * Read the registry's project list. Forgiving: a missing / unreadable / malformed
 * file yields `[]`, never throws. Deduped by resolved path, first wins.
 */
export async function listProjects(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord[]> {
  return (await readRegistry(fs, env)).projects
}

/**
 * Register a project. Idempotent by resolved path: when the path is already
 * registered, the existing record is returned untouched (addedAt survives);
 * otherwise the new record is appended and the file written back (preferences preserved).
 */
export async function addProject(
  path: string,
  addedAt: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord> {
  const absolute = resolve(path)
  const registry = await readRegistry(fs, env)
  const existing = registry.projects.find(project => resolve(project.path) === absolute)
  if (existing) return existing

  const record: ProjectRecord = { id: projectId(absolute), path: absolute, addedAt }
  registry.projects.push(record)
  await writeRegistry(registry, fs, env)
  return record
}

/**
 * Drop the project whose id matches and write the list back (preferences preserved).
 * Returns whether a record was removed; an empty/missing registry is a no-write `false`.
 */
export async function removeProject(
  id: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const registry = await readRegistry(fs, env)
  const remaining = registry.projects.filter(project => project.id !== id)
  if (remaining.length === registry.projects.length) return false
  await writeRegistry({ projects: remaining, preferences: registry.preferences }, fs, env)
  return true
}

/** The user's dashboard preferences (#410), or `{}` when none are stored. */
export async function readPreferences(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Preferences> {
  return (await readRegistry(fs, env)).preferences
}

/** Persist the dashboard preferences (#410), sanitized, preserving the project list. */
export async function writePreferences(
  preferences: Preferences,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const registry = await readRegistry(fs, env)
  await writeRegistry({ projects: registry.projects, preferences: sanitizePreferences(preferences) }, fs, env)
}

/** A {@link PreferencesStore} bound to the real registry file, wired by the daemon so the
 * dashboard's preferences RPCs read/write the user's home file. */
export function registryPreferencesStore(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): PreferencesStore {
  return {
    read: () => readPreferences(fs, env),
    save: preferences => writePreferences(preferences, fs, env),
  }
}
