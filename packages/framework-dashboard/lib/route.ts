// The dashboard's address (#784): `/` is the Overview, `/{projectId}` a project's home/launcher,
// `/{projectId}/{sessionId}` one session. The URL is the selection — what used to be three pieces
// of React state guessing at each other, which is where the #761/#766/#768/#774 bugs came from.
//
// `sessionId` is the run id (`RunMeta.id`), not the agent's conversation id: only the run id is
// ours, stable, and already the name of the run's worktree directory. The URL-facing spelling is
// "session" because that is the user-facing word for a run (#771).
//
// Both ids are URL-safe by construction (the registry derives a project id from its path, a run id
// from its start time), so the segments are still encoded/decoded — a URL typed by hand is input.

/**
 * The one first segment that names a view rather than a project (#958).
 *
 * Safe to reserve because a project id is never this word: the registry builds one as
 * `<slugified basename>-<hash in base36>`, so every real id carries a `-<hash>` suffix.
 */
export const SETTINGS_SEGMENT = 'settings'

/** What the dashboard is looking at, as carried by the URL. */
export interface Route {
  /** A top-level view belonging to no project (#958). Absent on the Overview/project/session axis. */
  view?: 'settings'
  /** The selected project, or null for the Overview. */
  projectId: string | null
  /** The selected session (run id), or null for the project's home/launcher. */
  runId: string | null
}

/** Read the route out of a path. Anything unparseable is the Overview, and extra segments are ignored. */
export function parseRoute(pathname: string): Route {
  const [projectId, runId] = pathname.split('/').filter(Boolean).map(decodeSegment)
  if (projectId === SETTINGS_SEGMENT) return { view: 'settings', projectId: null, runId: null }
  if (!projectId) return { projectId: null, runId: null }
  return { projectId, runId: runId ?? null }
}

/** The path for a route — the inverse of {@link parseRoute}. */
export function formatRoute({ view, projectId, runId }: Route): string {
  if (view === 'settings') return `/${SETTINGS_SEGMENT}`
  if (!projectId) return '/'
  const project = encodeURIComponent(projectId)
  return runId ? `/${project}/${encodeURIComponent(runId)}` : `/${project}`
}

/** A percent-encoded segment, or the raw one when it is malformed (a hand-typed URL is input). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
