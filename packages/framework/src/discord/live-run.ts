import type { FrameworkEvent } from '../events.js'
import { nodeStoreFs, readEventLog, readLiveMetas, type StoreFs } from '../store/index.js'
import type { Gate, RunSnapshot } from './routing.js'

/**
 * Turn a project's on-disk run state into the {@link RunSnapshot} routing decides against (#680).
 *
 * The parked gate needs its options, and those are not on the run meta: `pendingChoice` carries
 * only the gate's id and title, because that is all the dashboard's rail needed. The options live
 * in the `choice` event, so answering "2" from chat means reading the run's event log — through
 * the store's own reader, so this surface cannot keep a drifted copy of the torn-line policy.
 *
 * Known constraint (#945): chat models ONE live run per project. A project can run several
 * sessions at once since #736, and `snapshotLiveRun` picks the first running meta the store
 * lists — the newest by id, since `readLiveMetas` sorts newest-first — so a chat message always
 * routes to the newest running run, which is not necessarily the one the user means. This is an
 * accepted MVP limit of the chat surface, not an oversight — lifting it means letting the bot
 * list and target runs, which is #945's real fix. Do not "fix" the pick order here; a different
 * deterministic pick is no better when the user cannot choose.
 */

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
    const gate = openGate(await readEventLog(running.cwd, fs), running.pendingChoice.id)
    if (gate) snapshot.gate = gate
  }
  return snapshot
}
