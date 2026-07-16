import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChoiceBy } from './events.js'
import { FRAMEWORK_DIR } from './store/index.js'
import { JsonlTailer, followFile } from './jsonl-tail.js'

/**
 * The dashboard-to-run control channel (#344): the reverse of the event log.
 * Events flow run -> `.the-framework/events.jsonl` -> daemon -> browser; steering
 * flows browser -> daemon -> `.the-framework/control.jsonl` -> run. The daemon
 * appends a {@link ControlEntry} per Stop click / choice pick, and the run tails
 * the file, aborting or resolving its parked gate. Same file-is-the-seam design
 * as the forward direction — no run<->daemon IPC.
 */

/** The control log filename under `.the-framework/`. */
export const CONTROL_FILE = 'control.jsonl'

/** One steering instruction from the dashboard to the live run. */
export type ControlEntry =
  /** Stop the run (the daemon dashboard's Stop button). */
  | { kind: 'stop' }
  /** Resolve a parked choice gate: the pick for the pending {@link ChoiceRequest} id. */
  | { kind: 'choice'; id: string; pick: string | string[]; by: ChoiceBy }

/** The control log path for a workspace. */
export function controlPath(cwd: string): string {
  return join(cwd, FRAMEWORK_DIR, CONTROL_FILE)
}

/** Append one entry to the workspace's control log, creating it as needed. */
export async function appendControl(cwd: string, entry: ControlEntry): Promise<void> {
  await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
  await appendFile(controlPath(cwd), JSON.stringify(entry) + '\n')
}

/**
 * Truncate the control log. A run calls this at start so a previous run's picks
 * can never fire into this one (gate ids like `plan-approval` repeat across runs).
 */
export async function resetControl(cwd: string): Promise<void> {
  await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
  await writeFile(controlPath(cwd), '')
}

/** A live control tail. {@link close} stops watching (idempotent). */
export interface ControlWatcher {
  close(): void
}

/**
 * Tail the workspace's control log, dispatching each well-formed entry as it is
 * appended. An `fs.watch` on `.the-framework/` plus a poll backstop, mirroring the
 * daemon's event tail (`fs.watch` is unreliable across platforms). Malformed or
 * unknown lines are skipped so a bad write can never crash a run.
 */
export function watchControl(
  cwd: string,
  onEntry: (entry: ControlEntry) => void,
  pollMs = 300,
): ControlWatcher {
  const tailer = new JsonlTailer<ControlEntry>(controlPath(cwd), entry => {
    if (isControlEntry(entry)) onEntry(entry)
  })
  // unref: never keep the process alive just for steering.
  const stop = followFile(join(cwd, FRAMEWORK_DIR), () => tailer.pull(), { pollMs, unref: true })
  return { close: stop }
}

/** Shape-check a parsed line. A multi-select pick may legitimately be `[]`. */
function isControlEntry(value: unknown): value is ControlEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v['kind'] === 'stop') return true
  if (v['kind'] !== 'choice') return false
  if (typeof v['id'] !== 'string' || !v['id']) return false
  const pick = v['pick']
  return typeof pick === 'string' || (Array.isArray(pick) && pick.every(p => typeof p === 'string'))
}
