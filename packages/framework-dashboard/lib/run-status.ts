import type { FrameworkEvent } from '@gemstack/the-framework'
import { runProgress } from '@gemstack/the-framework/client'
import { isRunActive, runOutcome } from './live-state.js'

/** How a run's one status pill is drawn: its dot colour, its word, and the word's tone. */
export type RunStatusPill = { dot: string; label: string; tone: string }

/**
 * The single status a run is in, ranked, or null while it has said nothing worth a pill.
 *
 * The states are deliberately exclusive — one run, one word. A run can hold more than one of
 * the underlying facts at once (it can signal ready-for-merge and then be stopped, or fail
 * after signalling it), so the ranking decides which one is shown: how the run ENDED outranks
 * anything it said on the way (#948), because the green "ready for merge" would otherwise be a
 * lie about a run that then failed or was killed.
 *
 * Shared so the session toolbar and the overview cannot drift apart on what a run is.
 */
export function runStatusPill(events: FrameworkEvent[]): RunStatusPill | null {
  const progress = runProgress(events)
  const outcome = runOutcome(events)
  const failed = outcome !== undefined && !outcome.ok && !outcome.stopped
  const stopped = outcome?.stopped === true
  // Nothing to say yet: a run that has not named itself, reached a state, or ended.
  if (!progress.sessionName && !progress.readyForMerge && !failed && !stopped) return null
  if (failed) {
    return { dot: 'bg-danger', label: outcome?.detail ? `failed — ${outcome.detail}` : 'failed', tone: 'text-danger' }
  }
  if (stopped) return { dot: 'bg-warning', label: 'stopped', tone: 'text-warning' }
  if (progress.readyForMerge) return { dot: 'bg-success', label: 'ready for merge', tone: 'text-muted-foreground' }
  // A run only pulses "building…" while it is live (#695/U20): once `end` lands the pill settles.
  if (isRunActive(events)) return { dot: 'animate-pulse bg-warning', label: 'building…', tone: 'text-muted-foreground' }
  return { dot: 'bg-muted-foreground', label: 'finished', tone: 'text-muted-foreground' }
}
