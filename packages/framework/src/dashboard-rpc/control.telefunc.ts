import { getContext } from 'telefunc'
import { appendControl, type ControlEntry } from '../control.js'
import { openInApp, type OpenTarget, type OpenResult } from '../dashboard/open-in-app.js'
import { resolveProjectPath, contextPreferences } from './context.js'
import type { ChoiceBy } from '../events.js'
import type { PreviewResult, PreviewStatus, StartRunKind, StartRunOptions, StartRunResult } from '../dashboard/types.js'
import type { ServeTarget } from '../preview.js'
import type { DashboardContext } from '../dashboard/telefunc-serve.js'
import type { Preferences } from '../registry.js'

// The write side behind the new dashboard (#405): steering a live run. The reverse of
// the event stream — events flow run -> events.jsonl -> Channel -> browser; steering
// flows browser -> here -> the project's `.the-framework/control.jsonl` -> run, which
// tails that file and aborts or resolves its gate. Same file-is-the-seam design as the
// daemon's legacy onStop/onChoice (#344/#393), so any live run in the project is
// steerable. (Starting a run needs a spawn + the daemon's busy guard, so `sendStart`
// lands with the daemon-serves-the-bundle wiring, not here.)

/**
 * Resolve the project's local path and append one steering entry to its `control.jsonl`.
 * A no-op when the project has no local path (the read-only relay), so the run channel is
 * only ever written by a host that owns the workspace.
 */
async function appendControlFor(projectId: string, entry: ControlEntry): Promise<void> {
  const cwd = await resolveProjectPath(projectId)
  if (cwd) await appendControl(cwd, entry)
}

/** Stop the project's live run (the Stop button): append a stop entry to its control log. */
export async function sendStop(projectId: string): Promise<void> {
  await appendControlFor(projectId, { kind: 'stop' })
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
  await appendControlFor(projectId, { kind: 'choice', id, pick, by })
}

/**
 * Send a live-chat message to the project's running run (#714): append a `message` entry
 * that the run drains between turns, continuing the same session via `--resume`. Empty
 * messages are dropped.
 */
export async function sendMessage(projectId: string, text: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  await appendControlFor(projectId, { kind: 'message', text: message })
}

/**
 * Start a run in the project (#405, #345): the one write that needs the daemon, since
 * spawning goes through the daemon's own `startRun` closure (with its one-run-per-
 * project busy guard). The daemon provides `startRun` on the Telefunc request context,
 * so this runs in-process. `kind` defaults to a plain build run; a `build`/`prompt`
 * needs a non-empty prompt, `research` may be empty (its "what" defaults server-side).
 * Returns the daemon's {@link StartRunResult} — `busy` when a run is already active.
 */
export async function sendStart(
  projectId: string,
  prompt: string,
  kind: StartRunKind = 'build',
  options: StartRunOptions = {},
): Promise<StartRunResult> {
  const { startRun } = getContext<DashboardContext>()
  if (!startRun) return { ok: false, error: 'starting a run is not enabled on this server' }
  const text = prompt.trim()
  if (!text && kind !== 'research') return { ok: false, error: 'a non-empty prompt is required' }
  return startRun(text, kind, options, projectId)
}

/**
 * Open a project's Preview (#475): serve its built result on demand and return the live URL.
 * The daemon provides the Preview handlers on the request context, so this runs in-process
 * (like `sendStart`). Idempotent — opening while a preview is up returns the running one.
 * Returns an error result when Preview is not enabled on this host (the relay/per-run view).
 */
export async function sendPreview(projectId: string, targetId?: string): Promise<PreviewResult> {
  const { preview } = getContext<DashboardContext>()
  if (!preview) return { ok: false, error: 'preview is not enabled on this server' }
  return preview.start(projectId, targetId)
}

/**
 * List a project's servable apps (#651) for the Serve picker: the root plus each workspace package
 * that has a dev/serve script. A single-package repo returns at most one, so the button stays a
 * plain Serve; a monorepo returns several to choose from. Empty when Preview is not enabled.
 */
export async function onServeTargets(projectId: string): Promise<ServeTarget[]> {
  const { preview } = getContext<DashboardContext>()
  if (!preview) return []
  return preview.targets(projectId)
}

/** Stop a project's Preview (#475). A no-op when none is running, or Preview is not enabled. */
export async function sendStopPreview(projectId: string): Promise<void> {
  const { preview } = getContext<DashboardContext>()
  if (preview) await preview.stop(projectId)
}

/** Report whether a project's Preview is already running (#475), so a reload rehydrates the button. */
export async function onPreviewStatus(projectId: string): Promise<PreviewStatus> {
  const { preview } = getContext<DashboardContext>()
  if (!preview) return { running: false }
  return preview.status(projectId)
}

/**
 * Open a project in the OS file manager or an editor (#490). Localhost-only: the daemon
 * spawns a local command against the project's own registered path. A public host has no
 * local path to resolve, so it returns an error rather than spawning anything.
 */
export async function sendOpenInApp(projectId: string, target: OpenTarget): Promise<OpenResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  // #727: honour the stored editor preference; absent falls back to $FRAMEWORK_EDITOR, then `code`.
  const editor =
    target === 'editor' ? (await contextPreferences()?.read().catch((): Preferences => ({})))?.editor : undefined
  return openInApp(cwd, target, undefined, editor)
}
