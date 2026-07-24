import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isAgentName } from './agent-names.js'
import { nodeFs } from './node-fs.js'
import { PROJECT_PREFERENCE_KEYS, MAX_SPEND_OFFSET, type ProjectPreferences } from './preference-defaults.js'

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
   * Push a session's branch to `origin` when it finishes (#1102). Absent = on.
   *
   * Default-on, unlike most of this file, because it is what makes the handoff zero-config: the
   * old behaviour was a button nobody was obliged to press, and work that stayed on a local
   * branch nobody was told about (#860). A session can still opt out from its action bar.
   */
  autoPushBranch?: boolean
  /** Open a draft PR for a session's branch when it finishes (#1102). Absent = on; implies {@link autoPushBranch}. */
  autoOpenPr?: boolean
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
  /** Preferred editor for "Open in editor" (#727): an editor CLI (e.g. `code`, `cursor`, `zed`).
   * Absent falls back to `$FRAMEWORK_EDITOR`, then `code`. */
  editor?: string
  /** Dashboard color theme (#725): `system` (follow the OS, the default), `light`, or `dark`. Absent = system. */
  theme?: 'system' | 'light' | 'dark'
  /** Where a run executes (#1050): `local` (this device, the default) or `actions` (a fresh GitHub Actions runner); maps to `--run-on`. Absent = local. */
  target?: 'local' | 'actions'
  /**
   * Post a Discord message when a new item lands on the "needs you" queue (#627). Absent = off:
   * unlike the in-browser toggle, Discord reaches you when no dashboard is open, so it is opt-in.
   * Gates the daemon watcher *on top of* a `DISCORD_WEBHOOK` being set (the webhook is where to
   * post; this is whether to).
   */
  notifyDiscord?: boolean
  /**
   * Run the Discord chatbot (#680): take messages from Discord and drive runs with them, rather
   * than only posting notifications outward. Absent = off, like {@link notifyDiscord}, and for a
   * stronger reason — this one *acts* on what it reads. Gates the daemon's bot on top of a
   * `DISCORD_BOT_TOKEN` being set (the token is how to connect; this is whether to).
   */
  discordBot?: boolean
  /**
   * Auto PM (#685): let the daemon start a PM run by itself when the agent queue has run dry
   * and there is plenty of budget left, so leftover subscription quota goes on the roadmap
   * instead of expiring. **Absent = off**: it spends the user's allowance without being asked,
   * so it is opt-in like {@link notifyDiscord} rather than a baseline.
   */
  autoPm?: boolean
  /**
   * How far the automatic-consumption limit sits from the quota boundary, in percentage points
   * (#960). Absent or `0` puts it exactly on the boundary, which is the default policy of #879:
   * unattended work stops once the account has spent its share of the week.
   *
   * Negative holds unattended work back further; positive lets it borrow into the days still to
   * come. It is an *offset* rather than an absolute percentage so the limit travels with the
   * boundary as the week goes on, instead of being overtaken by it on day two.
   */
  autoSpendOffset?: number
  /** User-defined presets (#626): the user's own saved prompts, shown beside the built-in presets. */
  customPresets?: CustomPreset[]
  /**
   * Whether the Overview's Onboarding checklist has been dismissed (#958). Absent = show it,
   * so a fresh install is walked through setup; dismissing only hides it on the Overview, and
   * the same checklist stays available on the settings page.
   */
  onboardingDismissed?: boolean
  /**
   * Absolute path to the directory the user keeps their repos in (#1123): the default the
   * create-project flow (#1121) offers, and the root {@link reposDirectoryAutoGrant} scans.
   * Absent = no default. Kept only as a non-empty absolute path.
   */
  reposDirectory?: string
  /**
   * Auto-add and grant every git repo directly inside {@link reposDirectory} on daemon boot (#1123).
   * **Absent = off**: it hands the app filesystem access to a whole directory of repos at once, so it
   * is an explicit opt-in, and the blast radius is contained to that one directory.
   */
  reposDirectoryAutoGrant?: boolean
}

/**
 * The run options a project may override (#840). The rest of {@link Preferences} stays global
 * on purpose: `theme`, `editor`, the notification toggles and `customPresets` are about the
 * user, not the repo.
 *
 * These are the *user's* per-project choices, not the repo's: they live in the user's home
 * file rather than the committed `the-framework.yml` because `model` and `agent` name what
 * this machine runs, which is not something to impose on everyone who clones the repo.
 */
// The key list lives in the leaf `preference-defaults.ts` so the dashboard reads the same one
// (a second copy there erased the type link, see that module); re-exported so this stays the
// import site for everything that already reads it beside `Preferences`.
export { PROJECT_PREFERENCE_KEYS, MAX_SPEND_OFFSET, type ProjectPreferences } from './preference-defaults.js'

/**
 * The credentials the daemon needs to reach a third party, set from the dashboard (#1095).
 *
 * Their tier is the {@link Registry.daemonToken} one, not {@link Preferences}: top-level, so
 * neither the browser bundle nor the per-project override map can ever carry them. Nothing
 * reads a value back out to a client — the dashboard is told only that one is *present*
 * ({@link DiscordCredentialStatus}) — so the registry file stays the one place they exist.
 *
 * The alternative was a second file. This one already holds `daemonToken`, which authenticates
 * every request to a network-reachable daemon, so the file is a secret store since #1051; a
 * second one would only spread the same exposure over two paths to keep 0600 on.
 */
export interface RegistrySecrets {
  /** The Discord chatbot's token (#680). Overridden by `DISCORD_BOT_TOKEN` when that is set. */
  discordBotToken?: string
  /** Where Discord notifications are posted (#627). Overridden by `DISCORD_WEBHOOK` when that is set. */
  discordWebhook?: string
}

/** The {@link RegistrySecrets} keys, as a `Record` so the compiler enforces completeness both
 * ways — the same shape (and the same #944 lesson) as the preference tables below. */
const SECRET_KEYS: Record<keyof RegistrySecrets, true> = {
  discordBotToken: true,
  discordWebhook: true,
}

/** A bot token is ~70 chars and a webhook URL ~120; bounded so a hostile write can't bloat the file. */
const MAX_SECRET_LENGTH = 500

/**
 * The persisted registry file shape (#410): the project list plus the user preferences.
 * Older installs wrote a bare `ProjectRecord[]`; {@link readRegistry} still reads those and
 * the next write migrates the file to this object form.
 */
export interface Registry {
  projects: ProjectRecord[]
  preferences: Preferences
  /** Per-project overrides (#840), keyed by {@link ProjectRecord.id}. Absent keys fall through. */
  projectPreferences: Record<string, ProjectPreferences>
  /**
   * The shared daemon token (#1051): generated on the first non-loopback bind and reused after.
   * A top-level field, deliberately not a {@link Preferences} one, so it is never shipped to the
   * browser bundle or the per-project override map. Absent on a loopback-only machine.
   */
  daemonToken?: string
  /** Third-party credentials set from the dashboard (#1095). Absent until one is saved. */
  secrets?: RegistrySecrets
}

/** A read/write handle for the user preferences, threaded through the dashboard's Telefunc
 * context so a public host (the relay) can leave it unwired. */
export interface PreferencesStore {
  read(): Promise<Preferences>
  save(preferences: Preferences): Promise<void>
  /** One project's overrides (#840). Optional so a host that only stores globals still compiles. */
  readProject?(projectId: string): Promise<ProjectPreferences>
  saveProject?(projectId: string, preferences: ProjectPreferences): Promise<void>
}

/** The registry file name: a single file under `$XDG_CONFIG_HOME` (dotted under `$HOME`). */
export const REGISTRY_FILE = 'the-framework.json'

/** Owner read/write only: the file holds the daemon token (#1051) and the Discord credentials (#1095). */
export const REGISTRY_FILE_MODE = 0o600

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

/** The dotted basename topic scratch dirs live under, mirroring the registry file's. */
const TOPICS_DIR = 'the-framework-topics'

/**
 * The neutral scratch directory a project-less "topic" run (#1120) executes in: `<runId>/`
 * under a config-home folder, resolved exactly like {@link registryPath} so it never lands in a
 * repo. It is deliberately NOT a git checkout, which is what makes a topic run repo-less — a run
 * to ask a question, plan, or draft a ticket with no code for the agent to touch.
 */
export function topicScratchPath(env: NodeJS.ProcessEnv, runId: string): string {
  const root = env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, TOPICS_DIR) : join(env.HOME ?? '', '.' + TOPICS_DIR)
  return join(root, runId)
}

/** Minimal fs seam so the registry is unit-testable without touching disk. */
export interface RegistryFs {
  /** Rejects when the file is absent. */
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  /** Recursive; used on the registry file's parent dir. */
  mkdir(path: string): Promise<void>
  /**
   * Replace `to` with `from`, atomically. Optional only so an existing implementation of this
   * seam keeps compiling; without it {@link writeRegistry} falls back to the truncate-then-write
   * this method exists to avoid (#991).
   */
  rename?(from: string, to: string): Promise<void>
  /**
   * Narrow a file's permissions. Optional, and best-effort at the call site: this file holds the
   * daemon token (#1051) and the Discord credentials (#1095), so it is written owner-only — but a
   * filesystem that cannot express that (Windows, a FAT volume) must not fail the write.
   */
  chmod?(path: string, mode: number): Promise<void>
}

/** A {@link RegistryFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeRegistryFs(): RegistryFs {
  const { read, write, mkdir, rename, chmod } = nodeFs()
  return { read, write, mkdir, rename, chmod }
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

/** The boolean keys of {@link Preferences}, computed so the table below cannot drift from the type. */
type BooleanPreferenceKey = {
  [K in keyof Preferences]-?: NonNullable<Preferences[K]> extends boolean ? K : never
}[keyof Preferences]

/**
 * Every boolean preference, as a `Record` over {@link BooleanPreferenceKey} so the compiler
 * enforces completeness in both directions (#944): a typo fails as an unknown property, and
 * omitting a newly added boolean preference fails as a missing one. A plain `as const` array
 * only caught the first — an omission made {@link sanitizePreferences} silently drop the new
 * preference on every save, the write-then-vanish failure shape for a settings file.
 */
const BOOLEAN_PREFERENCES: Record<BooleanPreferenceKey, true> = {
  autopilot: true,
  technical: true,
  vanilla: true,
  eco: true,
  ecoPlanning: true,
  ecoResearch: true,
  ecoMaintenance: true,
  onBeforeMergeableQuality: true,
  browser: true,
  autoPushBranch: true,
  autoOpenPr: true,
  transparent: true,
  notifyBrowser: true,
  notifyDiscord: true,
  discordBot: true,
  notifyNewActivity: true,
  notifyHumanIntervention: true,
  autoPm: true,
  onboardingDismissed: true,
  reposDirectoryAutoGrant: true,
}

const PREFERENCE_KEYS = Object.keys(BOOLEAN_PREFERENCES) as BooleanPreferenceKey[]

/** Keep only the known preference fields, so a hand-edited or browser-supplied
 * object never lands junk (or the wrong type) in the user's home file. */
/** The color themes the dashboard offers (#725); anything else means the default `system`. */
const KNOWN_THEMES = ['system', 'light', 'dark'] as const
/** The run targets the dashboard offers (#1050); anything else means the default `local`. */
const KNOWN_RUN_TARGETS = ['local', 'actions'] as const

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
  // `agent` (#650) is constrained to the known set so junk never reaches the run; the set is
  // the shared node-free vocabulary (agent-names.ts). Default = claude.
  if (isAgentName(input['agent'] as string | undefined)) preferences.agent = input['agent'] as string
  // `editor` (#727) is a free-form CLI name, trimmed and length-capped so junk / a huge string
  // never lands in the file. A blank string is "no choice" (fall back to env / `code`), so dropped.
  if (typeof input['editor'] === 'string' && input['editor'].trim())
    preferences.editor = input['editor'].trim().slice(0, 100)
  // `theme` (#725) is constrained to the known set; anything else (incl. absent) means the default
  // `system`, so it is simply dropped rather than persisted.
  if (typeof input['theme'] === 'string' && (KNOWN_THEMES as readonly string[]).includes(input['theme']))
    preferences.theme = input['theme'] as (typeof KNOWN_THEMES)[number]
  // `target` (#1050) is a string, so the boolean-only PREFERENCE_KEYS loop would silently eat it;
  // it gets its own branch like `theme`, constrained to the known set (anything else = default `local`).
  if (typeof input['target'] === 'string' && (KNOWN_RUN_TARGETS as readonly string[]).includes(input['target']))
    preferences.target = input['target'] as (typeof KNOWN_RUN_TARGETS)[number]
  // `autoSpendOffset` (#960) is the one numeric preference: a slider position in percentage
  // points, clamped so a hand-edited file cannot push the limit somewhere the slider could not.
  const offset = input['autoSpendOffset']
  if (typeof offset === 'number' && Number.isFinite(offset))
    preferences.autoSpendOffset = Math.round(Math.min(Math.max(offset, -MAX_SPEND_OFFSET), MAX_SPEND_OFFSET))
  // `reposDirectory` (#1123) is a string, so like `target` the boolean-only loop would eat it. Kept
  // only as a non-empty absolute path; a relative or junk value is dropped rather than persisted.
  const reposDir = typeof input['reposDirectory'] === 'string' ? input['reposDirectory'].trim() : ''
  if (reposDir && isAbsolute(reposDir)) preferences.reposDirectory = reposDir
  const customPresets = sanitizeCustomPresets(input['customPresets'])
  if (customPresets.length) preferences.customPresets = customPresets
  return preferences
}

/**
 * Keep only the keys a project may override (#840), each sanitized by the same rules as the
 * global object, so a hand-edited registry cannot smuggle a global-only key onto a project.
 */
function sanitizeProjectPreferences(value: unknown): ProjectPreferences {
  const sanitized = sanitizePreferences(value) as Record<string, unknown>
  const preferences: Record<string, unknown> = {}
  for (const key of PROJECT_PREFERENCE_KEYS) {
    if (sanitized[key] !== undefined) preferences[key] = sanitized[key]
  }
  return preferences as ProjectPreferences
}

/** The whole per-project block, dropping malformed entries and projects that override nothing. */
function sanitizeProjectPreferenceMap(value: unknown): Record<string, ProjectPreferences> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const map: Record<string, ProjectPreferences> = {}
  for (const [id, stored] of Object.entries(value as Record<string, unknown>)) {
    if (!id) continue
    const preferences = sanitizeProjectPreferences(stored)
    if (Object.keys(preferences).length) map[id] = preferences
  }
  return map
}

/**
 * The preferences in force for a project (#840): the global object with the project's
 * overrides on top, so a project that sets nothing behaves exactly as it does today.
 * Only the keys the project actually stored win; the rest fall through.
 */
export function resolvePreferences(global: Preferences, project: ProjectPreferences | undefined): Preferences {
  return { ...global, ...project }
}

/**
 * Keep only well-formed custom presets (#626): each needs a non-empty id, label, and prompt;
 * label/prompt are trimmed and length-capped, the list capped at {@link CUSTOM_PRESET_LIMITS.count},
 * and duplicate ids dropped. A malformed entry is skipped, not thrown — a bad registry never breaks the read.
 */
export function sanitizeCustomPresets(value: unknown): CustomPreset[] {
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
 * The known secrets, kept only as non-empty trimmed strings (#1095) — the same "a hand-edited
 * file can't smuggle junk in" rule the daemon token gets. An unknown key is dropped, so the
 * block cannot become a scratch space for whatever a caller passes.
 */
function sanitizeSecrets(value: unknown): RegistrySecrets | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const secrets: RegistrySecrets = {}
  for (const key of Object.keys(SECRET_KEYS) as Array<keyof RegistrySecrets>) {
    const entry = raw[key]
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim().slice(0, MAX_SECRET_LENGTH)
    if (trimmed) secrets[key] = trimmed
  }
  return Object.keys(secrets).length ? secrets : undefined
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
  const empty: Registry = { projects: [], preferences: {}, projectPreferences: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.read(registryPath(env)))
  } catch {
    return empty
  }
  // Legacy format: a bare array of project records. Migrated to the object form on next write.
  if (Array.isArray(parsed)) return { ...empty, projects: dedupeProjects(parsed) }
  if (typeof parsed !== 'object' || parsed === null) return empty
  const obj = parsed as Record<string, unknown>
  const projects = Array.isArray(obj.projects) ? dedupeProjects(obj.projects) : []
  const secrets = sanitizeSecrets(obj.secrets)
  return {
    projects,
    preferences: sanitizePreferences(obj.preferences),
    projectPreferences: sanitizeProjectPreferenceMap(obj.projectPreferences),
    // #1051: kept only as a non-empty string, so a hand-edited registry can't smuggle a junk token.
    ...(typeof obj.daemonToken === 'string' && obj.daemonToken ? { daemonToken: obj.daemonToken } : {}),
    ...(secrets ? { secrets } : {}),
  }
}

/**
 * Write the registry back as pretty object-form JSON, creating the parent dir. The per-project
 * block is omitted while empty, so a user who never sets a per-project option keeps the file
 * they have today.
 *
 * Atomic (#991): the JSON goes to a temp file beside the real one and is then renamed over it,
 * the same shape #922 gave the daemon state file. A direct write truncates first, so a crash, a
 * kill or a full disk mid-write left a half file — and {@link readRegistry} reports a malformed
 * file as an empty registry, so every project and preference vanished silently. A failed write
 * now only ever damages the temp file. The temp is left behind on failure rather than swept up:
 * one stray file is the cheaper half of that trade.
 *
 * Written owner-only (#1095): the file carries the daemon token and the Discord credentials, so
 * a default-umask 0644 in a shared home would hand them to every other account on the machine.
 * The mode is set on the temp file, before the rename — narrowing after it would leave a window
 * where the real path is readable. Best-effort: a filesystem with no permission bits still writes.
 */
async function writeRegistry(registry: Registry, fs: RegistryFs, env: NodeJS.ProcessEnv): Promise<void> {
  const file = registryPath(env)
  const { projects, preferences, projectPreferences, daemonToken, secrets } = registry
  const contents = {
    projects,
    preferences,
    ...(Object.keys(projectPreferences).length ? { projectPreferences } : {}),
    ...(daemonToken ? { daemonToken } : {}),
    ...(secrets && Object.keys(secrets).length ? { secrets } : {}),
  }
  const json = JSON.stringify(contents, null, 2)
  await fs.mkdir(dirname(file))
  const restrict = (path: string) => fs.chmod?.(path, REGISTRY_FILE_MODE).catch(() => {})
  if (!fs.rename) {
    await fs.write(file, json)
    await restrict(file)
    return
  }
  const temp = `${file}.${process.pid}.tmp`
  await fs.write(temp, json)
  await restrict(temp)
  await fs.rename(temp, file)
}

/**
 * Serializes the read-modify-write mutators below (#991). Each reads the whole registry, edits it
 * and writes it back, and one daemon runs several concurrently: `daemon.ts` and `daemon-runtime.ts`
 * both call {@link addProject} while the dashboard's savePreferences RPC writes through
 * {@link registryPreferencesStore}. Interleaved, the later write was computed from a read taken
 * before the earlier one landed, so it silently dropped it. One tail promise for the module, not
 * one per file: the writes are small, and the registry is a single file per machine anyway.
 */
let mutations: Promise<void> = Promise.resolve()

function serialize<T>(mutate: () => Promise<T>): Promise<T> {
  const result = mutations.then(mutate)
  // A rejected mutation must not poison the queue, and must not surface as an unhandled rejection
  // here — the caller still gets `result`, which carries the error.
  mutations = result.then(
    () => {},
    () => {},
  )
  return result
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
  return serialize(async () => {
    const absolute = resolve(path)
    const registry = await readRegistry(fs, env)
    const existing = registry.projects.find(project => resolve(project.path) === absolute)
    if (existing) return existing

    const record: ProjectRecord = { id: projectId(absolute), path: absolute, addedAt }
    registry.projects.push(record)
    await writeRegistry(registry, fs, env)
    return record
  })
}

/**
 * Drop the project whose id matches and write the list back (preferences preserved).
 * Returns whether a record was removed; an empty/missing registry is a no-write `false`.
 * The project's own overrides (#840) go with it, so re-adding the path starts clean.
 */
export async function removeProject(
  id: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const remaining = registry.projects.filter(project => project.id !== id)
    if (remaining.length === registry.projects.length) return false
    const { [id]: _dropped, ...projectPreferences } = registry.projectPreferences
    await writeRegistry({ ...registry, projects: remaining, projectPreferences }, fs, env)
    return true
  })
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
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    await writeRegistry({ ...registry, preferences: sanitizePreferences(preferences) }, fs, env)
  })
}

/** One project's overrides (#840), or `{}` when it has none. */
export async function readProjectPreferences(
  projectId: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectPreferences> {
  return (await readRegistry(fs, env)).projectPreferences[projectId] ?? {}
}

/**
 * Persist one project's overrides (#840), sanitized, leaving the globals and every other
 * project untouched. Storing nothing drops the entry rather than leaving an empty object,
 * so the file stays readable and "overrides nothing" has one representation.
 */
export async function writeProjectPreferences(
  projectId: string,
  preferences: ProjectPreferences,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const sanitized = sanitizeProjectPreferences(preferences)
    const { [projectId]: _previous, ...rest } = registry.projectPreferences
    const projectPreferences = Object.keys(sanitized).length ? { ...rest, [projectId]: sanitized } : rest
    await writeRegistry({ ...registry, projectPreferences }, fs, env)
  })
}

/**
 * The shared daemon token (#1051): read the persisted one, or generate + persist it now. Called
 * only on a non-loopback bind, so a loopback-only machine never grows one. Serialized with the
 * other mutators so two concurrent binds can't each write a different token. `base64url` of 32
 * random bytes: URL-safe, so it drops straight into a `?token=` without encoding.
 */
export async function ensureDaemonToken(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    if (registry.daemonToken) return registry.daemonToken
    const daemonToken = randomBytes(32).toString('base64url')
    await writeRegistry({ ...registry, daemonToken }, fs, env)
    return daemonToken
  })
}

/**
 * The stored third-party credentials (#1095), or `{}` when none are set. Daemon-side only —
 * every caller is a service that needs the value itself, never a client read: what the dashboard
 * gets told is presence, in {@link RegistrySecrets}'s doc sense.
 */
export async function readSecrets(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<RegistrySecrets> {
  return (await readRegistry(fs, env)).secrets ?? {}
}

/**
 * Merge a patch into the stored credentials (#1095), leaving everything else in the file alone.
 *
 * A patch, not a whole-object write, because the caller is a UI that edits one field: the bot
 * dialog must not clear the webhook by not knowing it. An explicit `null` (or a blank string)
 * clears a key — that is the Clear button — while `undefined` leaves it as it was, so "not
 * mentioned" and "removed" stay different things. Serialized with the other mutators.
 */
export async function writeSecrets(
  patch: Partial<Record<keyof RegistrySecrets, string | null>>,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const next: Record<string, string> = { ...registry.secrets }
    for (const key of Object.keys(SECRET_KEYS) as Array<keyof RegistrySecrets>) {
      const value = patch[key]
      if (value === undefined) continue
      const trimmed = (value ?? '').trim()
      if (trimmed) next[key] = trimmed
      else delete next[key]
    }
    // Destructured off rather than overwritten: clearing the last credential must drop the key,
    // and `exactOptionalPropertyTypes` will not let an explicit `undefined` stand in for absent.
    const { secrets: _cleared, ...rest } = registry
    const secrets = sanitizeSecrets(next)
    await writeRegistry(secrets ? { ...rest, secrets } : rest, fs, env)
  })
}

/** The persisted daemon token (#1051), or `undefined` when none exists. A pure read, so a process
 * that only prints the reachable URL never generates one. */
export async function readDaemonToken(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  return (await readRegistry(fs, env)).daemonToken
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
    readProject: projectId => readProjectPreferences(projectId, fs, env),
    saveProject: (projectId, preferences) => writeProjectPreferences(projectId, preferences, fs, env),
  }
}
