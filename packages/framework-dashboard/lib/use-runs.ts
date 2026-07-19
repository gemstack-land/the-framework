import type { RunMeta } from '@gemstack/framework'
import { onRuns } from '../server/reads.telefunc.js'
import { usePolled } from './use-async.js'

// The selected project's runs (live + archived), polled. Owned by the shell (+Page) so both
// the Runs rail and the main pane read one list: the rail renders the rows, the pane routes
// the selected run to its live view or replay by that run's status.
export function useRuns(projectId: string | null): { runs: RunMeta[]; reload: () => void; loaded: boolean } {
  // `reload` is the shared guarded one now: it used to be a second, unguarded copy of the
  // read, so a run started just before a project switch could write the old project's runs.
  const { value: runs, reload, loaded } = usePolled<RunMeta[]>(
    projectId ? () => onRuns(projectId) : null,
    [],
    2000,
    [projectId],
  )
  // `loaded` is what lets the shell tell a session that is gone from one it has not read yet
  // (#784): a bookmarked link must not flash "gone" while the first read is still out.
  return { runs, reload, loaded }
}
