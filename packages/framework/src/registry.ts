import { basename, dirname, join, resolve } from 'node:path'
import { DEFAULT_CONSUMPTION_LIMITS, sanitizeConsumptionLimits, type ConsumptionLimits } from './consumption.js'
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

/**
 * A user-defined preset (#626): a named prompt the user saved to re-run their own high-signal
 * prompts, sitting beside the built-in presets in the Start form. Just data — the label is the
 * button, the prompt is loaded verbatim into the editor and run as a `prompt` kind (unlike the
 * built-ins, whose text is a compiled render function). `id` is stable so edits/deletes address one.
 */
export interface CustomPreset {
  id: string
  label: string
  prompt: string
}

/** The cap on saved custom presets, and the per-field lengths — enough for real prompts, bounded
 * so a hand-edited or hostile registry can't bloat the home file. */
export const CUSTOM_PRESET_LIMITS = { count: 30, label: 80, prompt: 20_000 } as const

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
   * Transparent mode (#625): run the wrapped agent raw — no framework system prompt, emit
   * protocols, consumption guard, dashboard, or TODO loop, so a run is identical to `claude -p`.
   * The coarse master off-switch ("only pick what you need"); maps to `--transparent`. Absent = off.
   */
  transparent?: boolean
  /** Fire a browser notification when a new item lands on the "needs you" queue (#627). Absent = on. */
  notifyBrowser?: boolean
  /**
   * Also notify on plain run activity — a run started, a run finished (#627). The default-off
   * counterpart to the always-on "needs you" notifications: it keeps you loosely informed of the
   * pipeline moving even when nothing needs you. A *category* toggle: it composes with the method
   * toggles ({@link notifyBrowser} / {@link notifyDiscord}), so activity reaches whichever are on.
   */
  notifyNewActivity?: boolean
  /**
   * The "needs you" category (#627): notify when a run is awaiting your answer or a PR is ready
   * to review. A *category* toggle, like {@link notifyNewActivity}, composing with the method
   * toggles ({@link notifyBrowser} / {@link notifyDiscord}). **Absent = on**: unlike the other
   * flat opt-in booleans, human-intervention pings are the baseline The Framework leans on, so an
   * unset preference keeps them firing; a user turns them off explicitly.
   */
  notifyHumanIntervention?: boolean
  /** The model to run on (#628), e.g. `opus` / `sonnet`; maps to a run's `--model`. Absent = the driver's default. */
  model?: string
  /** Which coding agent drives the run (#650): `claude` or `codex`; maps to `--agent`. Absent = the default (`claude`). */
  agent?: string
  /**
   * Post a Discord message when a new item lands on the "needs you" queue (#627). Absent = off:
   * unlike the in-browser toggle, Discord reaches you when no dashboard is open, so it is opt-in.
   * Gates the daemon watcher *on top of* a `DISCORD_WEBHOOK` being set (the webhook is where to
   * post; this is whether to).
   */
  notifyDiscord?: boolean
  /** User-defined presets (#626): the user's own saved prompts, shown beside the built-in presets. */
  customPresets?: CustomPreset[]
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
  'transparent',
  'notifyBrowser',
  'notifyDiscord',
  'notifyNewActivity',
  'notifyHumanIntervention',
] as const

/** Keep only the known preference fields, so a hand-edited or browser-supplied
 * object never lands junk (or the wrong type) in the user's home file. */
/** The coding agents the dashboard offers (#650); mirrors AGENTS in agent.ts, kept local. */
const KNOWN_AGENTS = ['claude', 'codex']

function sanitizePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return {}
  const input = value as Record<string, unknown>
  const preferences: Preferences = {}
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] === 'boolean') preferences[key] = input[key] as boolean
  }
  // `model` (#628) is a free-form string preference; the rest are booleans. A blank string is "no
  // choice", same as absent, so it is dropped rather than persisted.
  if (typeof input['model'] === 'string' && input['model'].trim()) preferences.model = input['model'].trim()
  // `agent` (#650) is constrained to the known set so junk never reaches the run; mirrors AGENTS
  // in agent.ts (kept local so the registry doesn't import the driver layer). Default = claude.
  if (typeof input['agent'] === 'string' && KNOWN_AGENTS.includes(input['agent'])) preferences.agent = input['agent']
  const customPresets = sanitizeCustomPresets(input['customPresets'])
  if (customPresets.length) preferences.customPresets = customPresets
  const consumptionLimits = sanitizeConsumptionLimits(input['consumptionLimits'])
  if (consumptionLimits) preferences.consumptionLimits = consumptionLimits
  return preferences
}

/**
 * Keep only well-formed custom presets (#626): each needs a non-empty id, label, and prompt;
 * label/prompt are trimmed and length-capped, the list capped at {@link CUSTOM_PRESET_LIMITS.count},
 * and duplicate ids dropped. A malformed entry is skipped, not thrown — a bad registry never breaks the read.
 */
function sanitizeCustomPresets(value: unknown): CustomPreset[] {
  if (!Array.isArray(value)) return []
  const out: CustomPreset[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (out.length >= CUSTOM_PRESET_LIMITS.count) break
    if (typeof raw !== 'object' || raw === null) continue
    const { id, label, prompt } = raw as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string' || typeof prompt !== 'string') continue
    const trimmedId = id.trim()
    const trimmedLabel = label.trim().slice(0, CUSTOM_PRESET_LIMITS.label)
    const trimmedPrompt = prompt.trim().slice(0, CUSTOM_PRESET_LIMITS.prompt)
    if (!trimmedId || !trimmedLabel || !trimmedPrompt || seen.has(trimmedId)) continue
    seen.add(trimmedId)
    out.push({ id: trimmedId, label: trimmedLabel, prompt: trimmedPrompt })
  }
  return out
}

/**
 * The limits in force: what the user set, with {@link DEFAULT_CONSUMPTION_LIMITS}
 * filling any gap.
 *
 * Absent means the defaults rather than "off", so a user who has never opened
 * the settings is still guarded (#519).
 */
export function resolveConsumptionLimits(preferences: Preferences | undefined): ConsumptionLimits {
  // sanitizeConsumptionLimits already fills every window, so a stored value is
  // whole: the only gap left to default is an absent one.
  return preferences?.consumptionLimits ?? DEFAULT_CONSUMPTION_LIMITS
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
