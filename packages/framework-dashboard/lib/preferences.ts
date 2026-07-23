import { useEffect, useSyncExternalStore } from 'react'
import type { CustomPreset, FrameworkFileConfig, Preferences, ProjectPreferences, ProjectSummary } from '@gemstack/the-framework'
import { preferencesFromFileConfig, notificationEnabled, PROJECT_PREFERENCE_KEYS } from '@gemstack/the-framework/client'
import {
  onPreferences,
  savePreferences,
  onProjectPreferences,
  saveProjectPreferences,
  onProjectPresets,
  saveProjectPresets,
} from '../server/preferences.telefunc.js'
import { onProjects } from '../server/projects.telefunc.js'
import { parseRoute } from './route.js'

// The dashboard's Global options (#410), owned by the daemon and persisted in the same
// `the-framework.json` as the project list — no more localStorage. Loaded once over Telefunc
// and cached in this module so every component (the Start form's toggles + the choice-gate
// countdown) reads one shared value and stays in lockstep: an update writes through to the
// cache, notifies subscribers, and persists daemon-side. Prerender has no daemon, so the
// server snapshot is the empty default and the real values load on the client.
//
// Two tiers since #840: the global object, and the open project's own run options on top of it.
// Components never see the split — `usePreferences()` hands back the resolved result, so a
// toggle reads the same way it always did — but a write lands on whichever tier owns the key.

/** Run options a project owns, as a Set for the write split; the rest of
 * {@link Preferences} is global (#840). The list itself is the framework's, via the
 * browser-safe client entry, so adding a key there routes it here without a second copy. */
const PROJECT_KEYS = new Set<string>(PROJECT_PREFERENCE_KEYS)

const EMPTY: Preferences = {}
const EMPTY_FILE: FrameworkFileConfig = {}
let cache: Preferences | null = null
let loading: Promise<void> | null = null
const projects = new Map<string, ProjectPreferences>()
const projectLoads = new Set<string>()
/** Each project's committed `the-framework.yml`, as served on the project payload (#842). */
const files = new Map<string, FrameworkFileConfig>()
let filesLoading: Promise<void> | null = null
let filesLoaded = false
/** Each project's shared custom presets, committed in its `.the-framework/custom-presets.json` (#1025). */
const projectPresets = new Map<string, CustomPreset[]>()
const projectPresetLoads = new Set<string>()
const EMPTY_PRESETS: CustomPreset[] = []
/** Resolved snapshots, one per project, cleared on every notify. `useSyncExternalStore` compares
 * snapshots by identity, so resolving fresh on each read would re-render forever. */
let resolved = new Map<string, Preferences>()
let sources = new Map<string, PreferenceSources>()
const listeners = new Set<() => void>()

function notify(): void {
  resolved = new Map()
  sources = new Map()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Which layer a resolved preference came from (#842). Absent = nobody set it. */
export type PreferenceSource = 'project' | 'repo' | 'global'

/** The winning layer per key, for showing what is inherited rather than yours. */
export type PreferenceSources = Partial<Record<keyof Preferences, PreferenceSource>>

/** The repo tier as preference keys: `the-framework.yml`, committed, shared by everyone who clones. */
function fileTier(projectId: string | null): Preferences {
  const file = projectId ? files.get(projectId) : undefined
  return file ? preferencesFromFileConfig(file) : EMPTY
}

function snapshot(projectId: string | null): Preferences {
  const key = projectId ?? ''
  const hit = resolved.get(key)
  if (hit) return hit
  const project = projectId ? projects.get(projectId) : undefined
  const repo = fileTier(projectId)
  // Nearest wins (#800/#841): your project options, then the repo's committed file, then global.
  const value =
    project || repo !== EMPTY ? { ...(cache ?? EMPTY), ...repo, ...project } : (cache ?? EMPTY)
  resolved.set(key, value)
  return value
}

function sourceSnapshot(projectId: string | null): PreferenceSources {
  const key = projectId ?? ''
  const hit = sources.get(key)
  if (hit) return hit
  const value: PreferenceSources = {}
  const tiers: [PreferenceSource, Preferences][] = [
    ['global', cache ?? EMPTY],
    ['repo', fileTier(projectId)],
    ['project', (projectId ? projects.get(projectId) : undefined) ?? EMPTY],
  ]
  // Later tiers are nearer, so each one that set a key overwrites the recorded source.
  for (const [name, values] of tiers) {
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined) value[k as keyof Preferences] = name
    }
  }
  sources.set(key, value)
  return value
}

function ensureLoaded(projectId: string | null): void {
  if (!cache && !loading) {
    loading = onPreferences()
      // `??=`, not `=`: a toggle made while this initial load was in flight already populated
      // the cache and persisted, so the load must not overwrite it with the pre-toggle value.
      .then(preferences => {
        cache ??= preferences
      })
      .catch(() => {
        cache ??= {}
      })
      .finally(() => {
        loading = null
        notify()
      })
  }
  if (!filesLoaded) loadFileConfigs()
  ensureProjectPresetsLoaded(projectId)
  if (!projectId || projects.has(projectId) || projectLoads.has(projectId)) return
  projectLoads.add(projectId)
  void onProjectPreferences(projectId)
    .then(preferences => {
      // Same `??=` reasoning as above: a toggle during the load already wrote this entry.
      if (!projects.has(projectId)) projects.set(projectId, preferences)
    })
    .catch(() => {
      if (!projects.has(projectId)) projects.set(projectId, {})
    })
    .finally(() => {
      projectLoads.delete(projectId)
      notify()
    })
}

/**
 * Load every project's `the-framework.yml` off the project payload (#842). One call covers all
 * projects, since that is what the RPC returns; the daemon re-reads the file on each request, so
 * refetching is how the launcher stops showing a stale answer after someone edits the yml.
 */
function loadFileConfigs(): void {
  if (filesLoading) return
  filesLoading = onProjects()
    .then((list: ProjectSummary[]) => {
      files.clear()
      for (const project of list) if (project.fileConfig) files.set(project.id, project.fileConfig)
    })
    .catch(() => {})
    .finally(() => {
      filesLoading = null
      filesLoaded = true
      notify()
    })
}

/**
 * Re-read the repo tier. Wired to the window regaining focus, which is when an edit made in an
 * editor becomes visible to someone looking at the launcher again.
 */
export function refreshFileConfigs(): void {
  loadFileConfigs()
}

if (typeof window !== 'undefined') window.addEventListener('focus', refreshFileConfigs)

/** Load a project's shared custom presets (#1025) once, from its committed `.the-framework/`. */
function ensureProjectPresetsLoaded(projectId: string | null): void {
  if (!projectId || projectPresets.has(projectId) || projectPresetLoads.has(projectId)) return
  projectPresetLoads.add(projectId)
  void onProjectPresets(projectId)
    .then(presets => {
      // `??=` reasoning as elsewhere: a save during the load already wrote this entry.
      if (!projectPresets.has(projectId)) projectPresets.set(projectId, presets)
    })
    .catch(() => {
      if (!projectPresets.has(projectId)) projectPresets.set(projectId, [])
    })
    .finally(() => {
      projectPresetLoads.delete(projectId)
      notify()
    })
}

/**
 * The open project's shared custom presets (#1025): the ones committed into its `.the-framework/`,
 * so everyone who clones the repo sees them. Empty with no project open, since there is no repo to
 * read them from.
 */
export function useProjectPresets(): CustomPreset[] {
  const projectId = typeof window === 'undefined' ? null : parseRoute(window.location.pathname).projectId
  const value = useSyncExternalStore(
    subscribe,
    () => (projectId ? (projectPresets.get(projectId) ?? EMPTY_PRESETS) : EMPTY_PRESETS),
    () => EMPTY_PRESETS,
  )
  useEffect(() => ensureProjectPresetsLoaded(projectId), [projectId])
  return value
}

/**
 * Replace the open project's shared presets, write-through then persist into its `.the-framework/`
 * (#1025). Best-effort like {@link updatePreferences}: a failed save is not worth surfacing over a
 * preset edit. A no-op when no project is open — there is no repo to commit them to.
 */
export function saveProjectPresetList(next: CustomPreset[]): void {
  const projectId = activeProjectId()
  if (!projectId) return
  projectPresets.set(projectId, next)
  void saveProjectPresets(projectId, next).catch(() => {})
  notify()
}

/**
 * The project a write belongs to, read straight off the URL (#784 makes it the selection).
 * `updatePreferences` runs in an event handler rather than a render, so it reads the location
 * instead of a hook: no module state to fall out of step with what the user is looking at.
 */
function activeProjectId(): string | null {
  if (typeof window === 'undefined') return null
  return parseRoute(window.location.pathname).projectId
}

/**
 * Merge a patch into the shared preferences, persist it daemon-side, and notify every
 * subscriber so the Start form and the choice gate stay in lockstep. The write-through keeps
 * the UI responsive; the save round-trip is best-effort (a failed save is not worth surfacing
 * over a checkbox toggle).
 *
 * With a project open, the run options in the patch land on that project and the rest stay
 * global (#840) — so changing the model for one repo no longer follows you into the next.
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  const projectId = activeProjectId()
  const entries = Object.entries(patch)
  const projectPatch = projectId ? entries.filter(([key]) => PROJECT_KEYS.has(key)) : []
  const globalPatch = entries.filter(([key]) => !projectId || !PROJECT_KEYS.has(key))

  if (globalPatch.length) {
    cache = { ...(cache ?? {}), ...Object.fromEntries(globalPatch) }
    void savePreferences(cache).catch(() => {})
  }
  if (projectId && projectPatch.length) {
    const next = { ...(projects.get(projectId) ?? {}), ...Object.fromEntries(projectPatch) }
    projects.set(projectId, next)
    void saveProjectPreferences(projectId, next).catch(() => {})
  }
  notify()
}

/** The open project's id, or null on a view with none — for deciding a preset can be shared (#1025). */
export function useActiveProjectId(): string | null {
  return typeof window === 'undefined' ? null : parseRoute(window.location.pathname).projectId
}

/**
 * The user preferences in force: the global object, the open project's committed
 * `the-framework.yml` (#842), then its own run options on top (#840). Loaded once from the daemon
 * per tier and kept in sync across components.
 */
export function usePreferences(): Preferences {
  const projectId = typeof window === 'undefined' ? null : parseRoute(window.location.pathname).projectId
  const preferences = useSyncExternalStore(
    subscribe,
    () => snapshot(projectId),
    () => EMPTY,
  )
  useEffect(() => ensureLoaded(projectId), [projectId])
  return preferences
}

/**
 * Where each resolved preference came from (#842), so the launcher can show a repo-inherited
 * value as not-yours rather than implying you chose it.
 */
export function usePreferenceSources(): PreferenceSources {
  const projectId = typeof window === 'undefined' ? null : parseRoute(window.location.pathname).projectId
  const value = useSyncExternalStore(
    subscribe,
    () => sourceSnapshot(projectId),
    () => EMPTY_SOURCES,
  )
  useEffect(() => ensureLoaded(projectId), [projectId])
  return value
}

/**
 * The open project's raw `the-framework.yml` (#842). The launcher shows `preset` and `event` from
 * it directly: they steer the run but have no preference counterpart, so the gear cannot set them.
 */
export function useProjectFileConfig(): FrameworkFileConfig {
  const projectId = typeof window === 'undefined' ? null : parseRoute(window.location.pathname).projectId
  const value = useSyncExternalStore(
    subscribe,
    () => (projectId ? (files.get(projectId) ?? EMPTY_FILE) : EMPTY_FILE),
    () => EMPTY_FILE,
  )
  useEffect(() => ensureLoaded(projectId), [projectId])
  return value
}

const EMPTY_SOURCES: PreferenceSources = {}

// Autopilot's default-on moved into @gemstack/the-framework with the rest of the preferences ->
// run options mapping (#858), so the daemon resolves it the same way. Re-exported here because
// every component reaches for it through this module.
export { autopilotEnabled } from '@gemstack/the-framework/client'

export type ThemePreference = NonNullable<Preferences['theme']>

/** The chosen dashboard theme (#725); absent follows the OS (`system`). */
export function themePreference(preferences: Preferences): ThemePreference {
  return preferences.theme ?? 'system'
}

/** Whether the dark palette applies, given the theme choice and the OS's dark preference. */
export function resolvedDark(theme: ThemePreference, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

// The five notification defaults are the framework's (#627), not the dashboard's: the daemon acts
// on the same values, and the polarities are not uniform, so a second copy here is how the two
// sides drift. These stay as named readers because the call sites read better for it.

/** Browser notifications; the browser permission is still the real gate. */
export function notificationsEnabled(preferences: Preferences): boolean {
  return notificationEnabled(preferences, 'notifyBrowser')
}

/** Discord delivery. The daemon's webhook is the other gate (where to post; this is whether to). */
export function discordEnabled(preferences: Preferences): boolean {
  return notificationEnabled(preferences, 'notifyDiscord')
}

/** The Discord chatbot (#680). The daemon's bot token is the other gate. */
export function discordBotEnabled(preferences: Preferences): boolean {
  return notificationEnabled(preferences, 'discordBot')
}

/** The "New activity" category: pings on a run starting or finishing. Composes with the methods above. */
export function newActivityEnabled(preferences: Preferences): boolean {
  return notificationEnabled(preferences, 'notifyNewActivity')
}

/** The "needs you" category: a run awaiting your answer, or a PR to review. */
export function humanInterventionEnabled(preferences: Preferences): boolean {
  return notificationEnabled(preferences, 'notifyHumanIntervention')
}
