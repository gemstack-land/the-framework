import { join } from 'node:path'
import type { FrameworkEvent } from '../events.js'
import { EVENTS_FILE, FRAMEWORK_DIR, nodeStoreFs, readLiveMetas, type StoreFs } from '../store/index.js'
import type { Gate, RunSnapshot } from './routing.js'

/**
 * Turn a project's on-disk run state into the {@link RunSnapshot} routing decides against (#680).
 *
 * The parked gate needs its options, and those are not on the run meta: `pendingChoice` carries
 * only the gate's id and title, because that is all the dashboard's rail needed. The options live
 * in the `choice` event, so answering "2" from chat means reading the run's event log.
 */

/** Read a run's live event log. Missing/unreadable yields `[]` — never throws. */
export async function readLiveEvents(runCwd: string, fs: StoreFs = nodeStoreFs()): Promise<FrameworkEvent[]> {
  const path = join(runCwd, FRAMEWORK_DIR, EVENTS_FILE)
  try {
    if (!(await fs.exists(path))) return []
    const events: FrameworkEvent[] = []
    for (const line of (await fs.read(path)).split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as FrameworkEvent)
      } catch {
        // A torn last line is normal while a run is writing; skip it.
      }
    }
    return events
  } catch {
    return []
  }
}

/**
 * The still-open gate with this id, or `undefined` when it was already answered. A gate is open
 * when its `choice` event has no later `choice-resolved` for the same id — otherwise a chat reply
 * would answer a question the dashboard already closed.
 */
export function openGate(events: FrameworkEvent[], gateId: string): Gate | undefined {
  let gate: Gate | undefined
  for (const event of events) {
    if (event.kind === 'choice' && event.id === gateId) {
      gate = {
        id: event.id,
        title: event.title,
        options: event.options.map(option => ({ id: option.id, label: option.label })),
        ...(event.multi ? { multi: true } : {}),
      }
    } else if (event.kind === 'choice-resolved' && event.id === gateId) {
      gate = undefined
    }
  }
  return gate
}

/**
 * The project's live run, with its parked gate resolved. `undefined` when nothing is running.
 * Forgiving throughout: a chat integration must never fail on unreadable run state.
 */
export async function snapshotLiveRun(
  projectId: string,
  projectCwd: string,
  fs: StoreFs = nodeStoreFs(),
): Promise<RunSnapshot | undefined> {
  const metas = await readLiveMetas(projectCwd, fs).catch(() => [])
  const running = metas.find(meta => meta.status === 'running')
  if (!running) return undefined

  const snapshot: RunSnapshot = { projectId, runId: running.id }
  if (running.pendingChoice) {
    const gate = openGate(await readLiveEvents(running.cwd, fs), running.pendingChoice.id)
    if (gate) snapshot.gate = gate
  }
  return snapshot
}
