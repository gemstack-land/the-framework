import { getContext } from 'telefunc'
import { defaultProjectsProvider, type ProjectsProvider } from '../dashboard/projects.js'
import type { EventsSource } from '../dashboard/telefunc-serve.js'

/**
 * The {@link ProjectsProvider} a telefunction should read a project id against (#427).
 * The mount puts one on the Telefunc request context: the daemon leaves it unset, so
 * every RPC resolves against the global registry; the per-run foreground dashboard
 * passes a single-project provider scoped to its `cwd`. Falls back to the registry when
 * no context is set (defensive — every real call runs inside `serve({ context })`).
 */
export function contextProjects(): ProjectsProvider {
  try {
    const ctx = getContext<{ projects?: ProjectsProvider }>()
    return ctx?.projects ?? defaultProjectsProvider()
  } catch {
    return defaultProjectsProvider()
  }
}

/**
 * The in-memory {@link EventsSource} on the context, or undefined (#426). Only the relay
 * sets one — it has no `.the-framework/events.jsonl` on disk, so `onEvents` streams from
 * the relay's in-memory run instead. Unset on the daemon/foreground, where `onEvents`
 * tails the file as before.
 */
export function contextEventsSource(): EventsSource | undefined {
  try {
    return getContext<{ eventsSource?: EventsSource }>()?.eventsSource
  } catch {
    return undefined
  }
}
