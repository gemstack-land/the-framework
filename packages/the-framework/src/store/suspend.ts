import { join } from 'node:path'
import { FRAMEWORK_DIR, nodeStoreFs, type StoreFs } from './run-store.js'

/** Where a project records the runs its daemon suspended (#923). Transient, like the run logs. */
export const SUSPENDED_FILE = 'suspended.json'

/**
 * How long a suspended run stays resumable, ms (#923). A daemon restart within the day picks
 * the work back up; a machine that has been off for a week does not wake up spending a day's
 * quota on work whose repo has moved on. Older entries are dropped, not resumed.
 */
export const SUSPEND_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** A run its daemon stopped at shutdown, and what is needed to pick it up again (#923). */
export interface SuspendedRun {
  /** The run's id, which is also its worktree and its row in the dashboard. */
  runId: string
  /** The agent conversation to continue, when the run got far enough to report one. */
  sessionId?: string
  /** When the daemon stopped it, ISO. */
  suspendedAt: string
}

function suspendedPath(cwd: string): string {
  return join(cwd, FRAMEWORK_DIR, SUSPENDED_FILE)
}

/** The runs this project's daemon suspended, or `[]` when there are none / the file is unreadable. */
export async function readSuspendedRuns(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<SuspendedRun[]> {
  try {
    const parsed = JSON.parse(await fs.read(suspendedPath(cwd))) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is SuspendedRun =>
        typeof entry === 'object' && entry !== null && typeof (entry as SuspendedRun).runId === 'string',
    )
  } catch {
    // absent / unreadable / malformed -> nothing to resume
    return []
  }
}

/** Record the runs a shutting-down daemon stopped. Replaces the list; an empty list clears it. */
export async function writeSuspendedRuns(cwd: string, runs: SuspendedRun[], fs: StoreFs = nodeStoreFs()): Promise<void> {
  await fs.mkdir(join(cwd, FRAMEWORK_DIR))
  await fs.write(suspendedPath(cwd), JSON.stringify(runs, null, 2) + '\n')
}

/**
 * The entries a booting daemon should pick back up: suspended recently enough to still be worth
 * resuming (#923). Pure, so the cutoff is testable without a clock. An entry with an unparseable
 * timestamp is dropped rather than resumed, since its age is exactly what the rule turns on; a
 * timestamp in the future (a clock that moved) counts as recent, and the entry is consumed by
 * that boot either way.
 */
export function resumableRuns(runs: SuspendedRun[], now: number, maxAgeMs: number = SUSPEND_MAX_AGE_MS): SuspendedRun[] {
  return runs.filter(run => {
    const at = Date.parse(run.suspendedAt)
    return Number.isFinite(at) && now - at <= maxAgeMs
  })
}
