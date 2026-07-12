import { defaultProjectsProvider, appendControl, type ChoiceBy } from '@gemstack/framework'

// The write side over Telefunc (#405): steering a live run from the new dashboard.
// The reverse of the event stream — events flow run -> events.jsonl -> Channel ->
// browser; steering flows browser -> here -> the project's `.the-framework/
// control.jsonl` -> run, which tails that file and aborts or resolves its gate. Same
// file-is-the-seam design as the daemon's onStop/onChoice (#344/#393), so no daemon
// process coupling: any live run in the project is steerable. (Starting a run needs a
// spawn + the daemon's busy guard, so it rides with the daemon-serves-the-bundle
// keystone, not this slice.)

/** The registry path for a project id, or undefined when unknown (a no-op steer). */
async function projectPath(projectId: string): Promise<string | undefined> {
  return defaultProjectsProvider().resolvePath(projectId)
}

/** Stop the project's live run (the Stop button): append a stop entry to its control log. */
export async function sendStop(projectId: string): Promise<void> {
  const cwd = await projectPath(projectId)
  if (cwd) await appendControl(cwd, { kind: 'stop' })
}

/**
 * Resolve the project's parked choice gate (#304/#332): `pick` is one option id for a
 * single-select, or the selected subset for a multi-select. `by` records who picked
 * (a human here, vs the autopilot countdown or a headless auto-accept).
 */
export async function sendChoice(
  projectId: string,
  id: string,
  pick: string | string[],
  by: ChoiceBy = 'user',
): Promise<void> {
  const cwd = await projectPath(projectId)
  if (cwd) await appendControl(cwd, { kind: 'choice', id, pick, by })
}
