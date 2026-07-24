import { useRef, useState } from 'react'
import { agentForDriver } from '@gemstack/the-framework/client'
import { Composer, type ComposerHandle } from './Composer.js'
import { sendMessage } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { useStartRun } from '../lib/use-start-run.js'
import type { RunOutcome } from '../lib/live-state.js'

// One composer for a session, live or finished (#1026).
//
// There used to be two: RunChat while the run was running, RunResumeChat once it ended. They
// looked identical and differed only in what submit did, but the session view swapped one for the
// other the moment a run stopped — so the editor remounted under the user, taking any half-typed
// message with it, and for a run that never reported a session id the composer vanished entirely
// and left a dead end.
//
// So the composer stays; the send changes:
//   - running          → a `message` control entry the run drains between turns (#714)
//   - ended, resumable → a fresh run seeded with `--resume <sessionId>`, continuing this run (#720)
//   - ended, no id     → a new session carrying the text, which is all that is left to offer
// A new-session preset (#959) always starts its own run, in every one of those states.
export function RunComposer({
  projectId,
  runId,
  live,
  sessionId,
  driver,
  files,
  addContext,
  removeContext,
  sessionName,
  onRunStarted,
  outcome,
}: {
  projectId: string
  /** Which run this addresses (#749); absent falls back to the project's control log. */
  runId?: string | null | undefined
  /** Whether the run is still running — the only thing that changes what a send does. */
  live: boolean
  /** The agent session id, once reported: what a finished run resumes from. */
  sessionId?: string | undefined
  /** The driver that ran it, so a continuation resumes on the same agent (#831). */
  driver?: string | undefined
  files: string[]
  addContext: (path: string) => void
  /** Drop a path from the run Context when its chip leaves the editor (#948). */
  removeContext?: ((path: string) => void) | undefined
  /** This session's name (#874), so a preset launched here targets it by default. */
  sessionName?: string | undefined
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
  /** How the run ended (#948), so the note does not call a crash "ended". */
  outcome?: RunOutcome | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const { busy, error, run } = useAction()
  const { busy: starting, error: startError, start } = useStartRun()
  // The last message that went through: a queued control entry is invisible until the agent
  // drains it between turns, so without this the send looked like nothing happened (#948).
  const [queued, setQueued] = useState<string | null>(null)
  const resumable = !live && sessionId !== undefined

  const send = async (text: string, _kind: 'build' | 'prompt', opts: { newSession: boolean }): Promise<void> => {
    if (busy || starting) return
    // A new-session preset is not a continuation (#959): it drops the resume seed and the run id,
    // so it opens its own run with its own worktree, branch and transcript.
    if (opts.newSession || (!live && !resumable)) {
      const started = await start(projectId, text, 'prompt', {})
      if (started) {
        composerRef.current?.clear()
        onRunStarted?.(text, started.runId)
      }
      composerRef.current?.focus()
      return
    }
    if (live) {
      // sendMessage resolves void; map success to `true` so it is tellable from useAction's
      // failure `undefined`.
      const result = await run(
        () => sendMessage(projectId, text, runId ?? undefined).then(() => true),
        'Could not send — the session may have just ended. Your text is kept, try again.',
      )
      if (result) {
        setQueued(text)
        composerRef.current?.clear()
      }
      composerRef.current?.focus()
      return
    }
    // A continuation is a `prompt` run seeded with the finished run's session id (#720). It
    // resumes on the run's own agent; the model and the system-prompt options are moot here, since
    // the resumed transcript keeps the framing and model it already had.
    // The run's driver reports itself by driver name; `--agent` takes the agent name (#831).
    const agent = agentForDriver(driver)
    const result = await start(
      projectId,
      text,
      'prompt',
      {
        resumeSession: sessionId as string,
        // Continue this run rather than opening a new row (#762): the follow-up writes into the
        // same run, on the same branch, so one thing you asked for stays one entry.
        ...(runId ? { continueRunId: runId } : {}),
        ...(agent && agent !== 'claude' ? { agent } : {}),
      },
      'Failed to continue the session.',
    )
    if (result) {
      composerRef.current?.clear()
      onRunStarted?.(text, result.runId) // select the run we just started (#761)
    }
  }

  return (
    <div className="p-2">
      <Note live={live} resumable={resumable} outcome={outcome} queued={queued} muted={Boolean(error ?? startError)} />
      {(error ?? startError) && <p role="alert" className="mb-1 px-2 text-xs text-danger">{error ?? startError}</p>}
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        onSubmit={send}
        busy={busy || starting}
        submitLabel="Send"
        submitBusyLabel={live ? 'Sending…' : resumable ? 'Resuming…' : 'Starting…'}
        showAgentModel={false}
        inSession
        sessionName={sessionName}
        placeholder={
          live
            ? 'Message the session…  ( / commands · < tags · @ projects · # files )'
            : resumable
              ? 'Message the session to continue it…  ( / commands · < tags · @ projects · # files )'
              : // Not a continuation at all, so the box says so itself rather than a note above it
                // saying one thing and the box below inviting another (see {@link Note}).
                NOT_CONTINUABLE
        }
      />
    </div>
  )
}

/** A run that ended before reporting a session id cannot be resumed by any agent — the one state
 *  where the box is not a continuation. It is the composer's own placeholder rather than a note
 *  above it: the message is about what typing here does, so it belongs where you type. */
const NOT_CONTINUABLE =
  'This session can’t be continued — it ended before the agent reported a session id. Your next message starts a new one.'

/** What a send will do from here, in one line — it is not the same thing in all three states. */
function Note({
  live,
  resumable,
  outcome,
  queued,
  muted,
}: {
  live: boolean
  resumable: boolean
  outcome: RunOutcome | undefined
  queued: string | null
  muted: boolean
}) {
  if (live) {
    if (!queued || muted) return null
    return (
      <p role="status" className="mb-1 truncate px-2 text-xs text-muted-foreground">
        Queued — the session reads it between turns: &ldquo;{queued}&rdquo;
      </p>
    )
  }
  // The one case that is not a continuation says so in the composer's placeholder (NOT_CONTINUABLE),
  // so it is not also said here.
  if (!resumable) return null
  const text =
    outcome && !outcome.ok && !outcome.stopped
      ? 'Session failed — your next message resumes it where it stopped.'
      : outcome?.stopped
        ? 'Session stopped — your next message resumes it.'
        : 'Session ended — your next message continues it.'
  return <p className="mb-2 px-2 text-xs text-muted-foreground">{text}</p>
}
