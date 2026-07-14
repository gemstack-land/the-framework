import { useCallback, useEffect, useState } from 'react'
import type { RunMeta } from '@gemstack/framework'
import { onRuns } from '../server/reads.telefunc.js'

// The selected project's runs (live + archived), polled. Owned by the shell (+Page) so both
// the Runs rail and the main pane read one list: the rail renders the rows, the pane routes
// the selected run to its live view or replay by that run's status.
export function useRuns(projectId: string | null): { runs: RunMeta[]; reload: () => void } {
  const [runs, setRuns] = useState<RunMeta[]>([])

  const reload = useCallback(() => {
    if (!projectId) {
      setRuns([])
      return
    }
    void onRuns(projectId).then(setRuns)
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setRuns([])
      return
    }
    let live = true
    const tick = () => void onRuns(projectId).then(list => live && setRuns(list))
    tick()
    const poll = setInterval(tick, 2000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [projectId])

  return { runs, reload }
}
