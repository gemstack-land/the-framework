import { useEffect, useState } from 'react'
import type { RunHandoff } from '@gemstack/framework'
import { onRunHandoff } from '../server/reads.telefunc.js'
import { usePolled } from './use-async.js'
import { useAction } from './use-action.js'

/** What the run view knows about the session's branch, and how it acts on it. */
export type RunHandoffState = {
  handoff: RunHandoff | null
  /** True once the read has answered, so an empty state isn't flashed before then. */
  loaded: boolean
  busy: boolean
  error: string | null
  /** Which button is in flight, so it can say "Pushing…" rather than silently greying (#948). */
  pending: 'push' | 'pr' | null
  act: (which: 'push' | 'pr', fn: () => Promise<unknown>, fallback: string) => void
}

// The handoff read lifted out of its panel: the same answer now feeds two places — the summary and
// the actions in the run's action bar, and the commits/files detail the bar expands. Reading it
// once keeps them from disagreeing and halves the polling.
export function useRunHandoff(projectId: string, runId: string | null | undefined, enabled = true): RunHandoffState {
  // Polled rather than read once: a push or a PR opened from here (or from a terminal) changes
  // what to offer, and `reload` makes the bar's own actions land immediately. Not read while the
  // run is live (#1026): a branch still being written to has nothing to hand off yet.
  // Same as the bar above it (#1028): fifteen seconds at rest, but a PR lookup still in flight
  // holds the Push / Open PR offer back, so that one is worth asking again for straight away.
  const [everyMs, setEveryMs] = useState(15_000)
  const { value: handoff, reload, loaded } = usePolled<RunHandoff | null>(
    enabled && runId ? () => onRunHandoff(projectId, runId) : null,
    null,
    everyMs,
    [projectId, runId, enabled, everyMs],
  )
  useEffect(() => setEveryMs(handoff?.prPending ? 1_000 : 15_000), [handoff?.prPending])
  const { busy, error, run } = useAction()
  const [pending, setPending] = useState<'push' | 'pr' | null>(null)

  const act = (which: 'push' | 'pr', fn: () => Promise<unknown>, fallback: string): void => {
    setPending(which)
    void run(fn, fallback).then(result => {
      setPending(null)
      if (result !== undefined) reload()
    })
  }

  return { handoff, loaded, busy, error, pending, act }
}
