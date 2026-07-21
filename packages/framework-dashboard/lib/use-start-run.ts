import { sendStart } from '../server/control.telefunc.js'
import { useAction } from './use-action.js'

type StartArgs = Parameters<typeof sendStart>

// Starting a run is the one mutation with a failure branch of its own: the daemon refuses a
// second run on the same checkout with `busy`. Both composers that start runs (the launcher
// and the finished-run continuation) route through here, so the refusal reads the same on
// either surface and neither hand-rolls the busy/error/finally scaffold useAction owns.
export function useStartRun(): {
  busy: boolean
  error: string | null
  reset: () => void
  /** Start the run; resolves with the success branch, or `undefined` (error state set). */
  start: (
    projectId: string,
    text: string,
    kind: StartArgs[2],
    options: StartArgs[3],
    fallback?: string,
  ) => Promise<{ runId?: string | undefined } | undefined>
} {
  const { busy, error, reset, run } = useAction()
  const start = async (
    projectId: string,
    text: string,
    kind: StartArgs[2],
    options: StartArgs[3],
    fallback = 'Failed to start the session.',
  ) => {
    const result = await run(async () => {
      const outcome = await sendStart(projectId, text, kind, options)
      // The daemon's refusal is phrased for its own log; give the dashboard its words.
      if (!outcome.ok && outcome.busy) return { ...outcome, error: 'A session is already active for this project.' }
      return outcome
    }, fallback)
    return result?.ok ? result : undefined
  }
  return { busy, error, reset, start }
}
