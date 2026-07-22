import { getContext } from 'telefunc'
import { appendControl, type ControlEntry } from '../control.js'
import { isSafeVia } from '../conversations.js'
import { openInApp, type OpenTarget, type OpenResult } from '../dashboard/open-in-app.js'
import { resolveProjectPath, resolveRunPath, contextPreferences, contextPreview } from './context.js'
import { appendFlatTodoEntry } from '../todo-loop.js'
import { findRun, isSafeRunId, type RunMeta } from '../store/index.js'
import { removeProjectWorktree, deleteProjectRun } from '../worktrees.js'
import {
  openRunPullRequest,
  pushRunBranch,
  readRunHandoff,
  runBranchFor,
  type HandoffResult,
} from '../dashboard/run-handoff.js'
import type { ChoiceBy } from '../events.js'
import type {
  DeleteSessionResult,
  PreviewResult,
  PreviewStatus,
  RemoveWorktreeResult,
  StartRunKind,
  StartRunOptions,
  StartRunResult,
} from '../dashboard/types.js'
import type { ServeTarget } from '../preview.js'
import type { DashboardContext } from '../dashboard/telefunc-serve.js'
import type { Preferences } from '../registry.js'

// The write side behind the new dashboard (#405): steering a live run. The reverse of
// the event stream — events flow run -> events.jsonl -> Channel -> browser; steering
// flows browser -> here -> the run's `.the-framework/control.jsonl` -> run, which tails that
// file and aborts or resolves its gate. Same file-is-the-seam design as the daemon's legacy
// onStop/onChoice (#344/#393). Each steering call takes the run id (#749): a run tails the
// log inside its own worktree since #736, so the entry has to be written there. (Starting a run needs a spawn + the daemon's busy guard, so `sendStart`
// lands with the daemon-serves-the-bundle wiring, not here.)

/**
 * Resolve the checkout to steer and append one entry to its `control.jsonl`. A no-op when
 * there is no local path (the read-only relay), so the run channel is only ever written by a
 * host that owns the workspace.
 *
 * The `runId` is what makes steering land (#749): a run tails the control log inside its own
 * worktree, so an entry written to the project root reaches nothing. Absent, it addresses the
 * project root, which is still right for a run that has no worktree (the non-git fallback).
 */
async function appendControlFor(projectId: string, entry: ControlEntry, runId?: string): Promise<void> {
  const cwd = await resolveRunPath(projectId, runId)
  if (cwd) await appendControl(cwd, entry)
}

/** Stop a live run (the Stop button): append a stop entry to the run's control log. */
export async function sendStop(projectId: string, runId?: string): Promise<void> {
  await appendControlFor(projectId, { kind: 'stop' }, runId)
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
  runId?: string,
): Promise<void> {
  await appendControlFor(projectId, { kind: 'choice', id, pick, by }, runId)
}

/**
 * Send a live-chat message to the project's running run (#714): append a `message` entry
 * that the run drains between turns, continuing the same session via `--resume`. Empty
 * messages are dropped.
 *
 * `via` names the surface the message came through (#917), so the run records the turn where it
 * actually happened. The dashboard omits it and keeps its own default; the Discord bot passes
 * `discord`. An unsafe name is dropped rather than forwarded: it would reach a line-parsed
 * conversation heading, and the browser can call this, so it is not trusted input.
 */
export async function sendMessage(projectId: string, text: string, runId?: string, via?: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  const origin = isSafeVia(via) ? { via } : {}
  await appendControlFor(projectId, { kind: 'message', text: message, ...origin }, runId)
}

/**
 * Remove a retained worktree (#737). A run that failed or was stopped keeps its checkout so you
 * can inspect it; this is the explicit cleanup for one, since nothing removes them on a timer.
 *
 * The checks and the commit-first removal are {@link removeProjectWorktree}'s, shared with the
 * `framework worktrees rm` verb (#982) so the two surfaces cannot drift again. All this adds is
 * the daemon-only step: a retained worktree can still be serving (#797), and that dev server
 * holds the tree being removed, so it is stopped rather than having the directory pulled out
 * from under it.
 */
export async function sendRemoveWorktree(projectId: string, runId: string): Promise<RemoveWorktreeResult> {
  // Read the context before the first await: telefunc only exposes it synchronously, at the top
  // of the telefunction. Through the tolerant accessor, since this is also called directly.
  const preview = contextPreview()
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  return removeProjectWorktree(cwd, runId, {
    beforeRemove: async id => {
      await preview?.stop(projectId, id)
    },
  })
}

/**
 * Delete a session (#1032): remove it from the dashboard, records and all — the sibling of
 * {@link sendRemoveWorktree}, and the one destructive-of-history action, so its surface confirms
 * first. The checks, the worktree removal and what it leaves behind (the branch, the committed
 * `LOGS.md` line, the conversation record) are all {@link deleteProjectRun}'s; this adds only the
 * daemon step of stopping a preview that may be serving the worktree before it comes off disk.
 */
export async function sendDeleteSession(projectId: string, runId: string): Promise<DeleteSessionResult> {
  const preview = contextPreview()
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  return deleteProjectRun(cwd, runId, {
    beforeRemove: async id => {
      await preview?.stop(projectId, id)
    },
  })
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
  if (!startRun) return { ok: false, error: 'starting a session is not enabled on this server' }
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
export async function sendPreview(projectId: string, targetId?: string, runId?: string): Promise<PreviewResult> {
  const { preview } = getContext<DashboardContext>()
  if (!preview) return { ok: false, error: 'preview is not enabled on this server' }
  // With a session id this serves that session's own worktree (#797). Without one it is the
  // project's checkout, which is what the project home asks for.
  return preview.start(projectId, targetId, runId)
}

/**
 * List a project's servable apps (#651) for the Serve picker: the root plus each workspace package
 * that has a dev/serve script. A single-package repo returns at most one, so the button stays a
 * plain Serve; a monorepo returns several to choose from. Empty when Preview is not enabled.
 */
export async function onServeTargets(projectId: string, runId?: string): Promise<ServeTarget[]> {
  const { preview } = getContext<DashboardContext>()
  if (!preview) return []
  return preview.targets(projectId, runId)
}

/** Stop a project's Preview (#475). A no-op when none is running, or Preview is not enabled. */
export async function sendStopPreview(projectId: string, runId?: string): Promise<void> {
  const { preview } = getContext<DashboardContext>()
  if (preview) await preview.stop(projectId, runId)
}

/** Report whether a project's Preview is already running (#475), so a reload rehydrates the button. */
export async function onPreviewStatus(projectId: string, runId?: string): Promise<PreviewStatus> {
  const { preview } = getContext<DashboardContext>()
  if (!preview) return { running: false }
  return preview.status(projectId, runId)
}

/**
 * Open a project in the OS file manager or an editor (#490). Localhost-only: the daemon
 * spawns a local command against the project's own registered path. A public host has no
 * local path to resolve, so it returns an error rather than spawning anything.
 *
 * With a `runId` it opens that session's own checkout instead (#798) — the whole point of
 * opening it is to look at what the agent is doing, which is not in the project's tree.
 */
export async function sendOpenInApp(projectId: string, target: OpenTarget, runId?: string): Promise<OpenResult> {
  const cwd = runId ? await resolveRunPath(projectId, runId) : await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  // #727: honour the stored editor preference; absent falls back to $FRAMEWORK_EDITOR, then `code`.
  const editor =
    target === 'editor' ? (await contextPreferences()?.read().catch((): Preferences => ({})))?.editor : undefined
  return openInApp(cwd, target, undefined, editor)
}

/**
 * The session's own branch, or undefined when the run/project is unknown. Shared by the two
 * handoff actions so they address exactly what {@link onRunHandoff} reports on.
 */
async function handoffTargetFor(projectId: string, runId: string): Promise<{ cwd: string; run: RunMeta } | undefined> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !isSafeRunId(runId)) return undefined
  const run = await findRun(cwd, runId).catch(() => undefined)
  return run ? { cwd, run } : undefined
}

/**
 * Push a finished session's branch to `origin` (#799).
 *
 * A click rather than something the run does on its way out: pushing publishes the agent's work
 * to a shared remote under the user's name, which is the user's call.
 */
export async function sendPushBranch(projectId: string, runId: string): Promise<HandoffResult> {
  const target = await handoffTargetFor(projectId, runId)
  if (!target) return { ok: false, error: 'unknown session' }
  return pushRunBranch(target.cwd, runBranchFor(target.run))
}

/**
 * Open a PR for a finished session's branch (#799), pushing it first if the remote lacks it.
 *
 * The title and body come from what the run already recorded: the session name the agent chose
 * and the intent the user asked for. Nothing new is invented and nothing extra is asked of the
 * user, which is the point of "offer the next step rather than describe it".
 */
export async function sendOpenPullRequest(projectId: string, runId: string): Promise<HandoffResult> {
  const target = await handoffTargetFor(projectId, runId)
  if (!target) return { ok: false, error: 'unknown session' }
  const { cwd, run } = target
  const branch = runBranchFor(run)
  const handoff = await readRunHandoff(cwd, branch).catch(() => undefined)
  if (handoff && !handoff.exists) return { ok: false, error: `branch ${branch} no longer exists` }
  // Refuse rather than open an empty PR: a session that changed nothing has nothing to hand off.
  if (handoff?.empty) return { ok: false, error: 'this session produced no commits to open a PR for' }
  if (handoff?.pr) return { ok: true, url: handoff.pr.url }
  return openRunPullRequest(cwd, branch, {
    title: run.sessionName ?? run.intent?.split('\n')[0]?.slice(0, 72) ?? `Session ${run.id}`,
    body: prBodyFor(run),
    ...(handoff?.base ? { base: handoff.base } : {}),
  })
}

/** The PR body: what was asked for, and which session did it. */
function prBodyFor(run: RunMeta): string {
  const lines: string[] = []
  if (run.intent) lines.push(run.intent.trim(), '')
  lines.push(`Opened from The Framework session \`${run.sessionName ?? run.id}\`.`)
  return lines.join('\n')
}

/** What {@link sendQueueTicket} did: the backlog file written, or why it could not be. */
export interface QueueTicketResult {
  ok: boolean
  /** The workspace-relative backlog the entry landed in, when it landed. */
  file?: string
  error?: string
}

/**
 * Put a ticket on the project's agent queue (#697), so the next drain run works it.
 *
 * A direct write rather than a run: the queue is a plain file the dashboard already reads,
 * and asking an agent to append one line would cost a turn and could do anything else besides.
 * It writes the project checkout's flat backlog specifically, which is the durable queue #624
 * settled on and the one a worktree run's queue is promoted into (#852).
 */
export async function sendQueueTicket(projectId: string, entry: string): Promise<QueueTicketResult> {
  const trimmed = entry.trim()
  if (!trimmed) return { ok: false, error: 'a ticket is required' }
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'no such project' }
  const file = await appendFlatTodoEntry(cwd, trimmed)
  return file ? { ok: true, file } : { ok: false, error: 'the queue could not be written' }
}
