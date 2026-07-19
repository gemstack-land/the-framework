import { getContext } from 'telefunc'
import { readLiveMetas, worktreePath, isSafeRunId } from '../store/index.js'
import { nodeFs } from '../node-fs.js'
import { defaultProjectsProvider, type ProjectsProvider } from '../dashboard/projects.js'
import type { DashboardContext, EventsSource } from '../dashboard/telefunc-serve.js'
import type { PreferencesStore } from '../registry.js'
import type { QuotaSource } from '../dashboard/quota.js'

/**
 * Read one field off the Telefunc request context, or undefined when it is unset. Every
 * real call runs inside `serve({ context })`; the try/catch is the defensive fallback for
 * a call made outside a request. The named accessors below add each field's meaning; this
 * is the shared plumbing they all sit on.
 */
function fromContext<T>(pick: (ctx: DashboardContext) => T | undefined): T | undefined {
  try {
    return pick(getContext<DashboardContext>())
  } catch {
    return undefined
  }
}

/**
 * The {@link ProjectsProvider} a telefunction should read a project id against (#427).
 * The mount puts one on the Telefunc request context: the daemon leaves it unset, so
 * every RPC resolves against the global registry; the per-run foreground dashboard
 * passes a single-project provider scoped to its `cwd`. Falls back to the registry when
 * no context is set (defensive — every real call runs inside `serve({ context })`).
 */
export function contextProjects(): ProjectsProvider {
  return fromContext(ctx => ctx.projects) ?? defaultProjectsProvider()
}

/** The workspace path for a project id (registry, or single-project #427), else undefined. */
export function resolveProjectPath(projectId: string): Promise<string | undefined> {
  return contextProjects().resolvePath(projectId)
}

/**
 * The checkout a call should act on: a live run's own worktree when `runId` names one (#738/#749),
 * else the project root. Since #736 a run reads and writes inside its worktree — its event log,
 * its control log, its working tree — so anything addressed at a *run* has to resolve here, not
 * at the project path, or it reads an empty log and steers a run that is not listening.
 *
 * An unknown or finished `runId` falls back to the project root rather than failing: the run's
 * worktree may already be gone, and the project's own state is still the sane thing to act on.
 */
export async function resolveRunPath(projectId: string, runId?: string): Promise<string | undefined> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !runId || !isSafeRunId(runId)) return cwd
  const live = await readLiveMetas(cwd).catch(() => [])
  const running = live.find(run => run.id === runId)?.cwd
  if (running) return running
  // Not in the live list yet. That is the normal state for the first seconds of a run (#766): the
  // daemon creates the worktree and spawns the process, and only then does the run write its
  // `run.json`, so a lookup by run state misses a run that certainly exists. The directory is named
  // with the run id and is there before the process starts, so ask the filesystem instead.
  //
  // This matters beyond a slow first read: a Telefunc Channel resolves its path once, when the
  // client subscribes. Falling back to the project root here does not self-correct a moment later
  // — it tails the wrong file for the life of the subscription, which is how a newly started run
  // ended up showing a previous run's output.
  const path = worktreePath(cwd, runId)
  return (await nodeFs().isDirectory(path)) ? path : cwd
}

/**
 * The in-memory {@link EventsSource} on the context, or undefined (#426). Only the relay
 * sets one — it has no `.the-framework/events.jsonl` on disk, so `onEvents` streams from
 * the relay's in-memory run instead. Unset on the daemon/foreground, where `onEvents`
 * tails the file as before.
 */
export function contextEventsSource(): EventsSource | undefined {
  return fromContext(ctx => ctx.eventsSource)
}

/**
 * The user-preferences store on the context, or undefined (#410). The daemon/foreground wire
 * the real registry file; a public host (the relay) leaves it unset, so the preferences RPCs
 * degrade to a read-only default / a no-op write on a shared host.
 */
export function contextPreferences(): PreferencesStore | undefined {
  return fromContext(ctx => ctx.preferences)
}

/**
 * The quota source on the context, or undefined (#533). The daemon wires a live
 * poller; a public host (the relay) leaves it unset, since it has no agent to ask
 * and no business reading someone else's account.
 */
export function contextQuota(): QuotaSource | undefined {
  return fromContext(ctx => ctx.quota)
}
