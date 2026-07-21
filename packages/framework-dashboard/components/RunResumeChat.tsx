import { useRef } from 'react'
import { Composer, type ComposerHandle } from './Composer.js'
import { agentForDriver } from '@gemstack/framework/client'
import { useStartRun } from '../lib/use-start-run.js'
import type { RunOutcome } from '../lib/live-state.js'

// The finished-run composer (#720): keep talking to a run that has ended. A live run drains
// messages in-process (RunChat + sendMessage), but a finished run has no process — so sending here
// spins a FRESH run whose opening prompt `--resume`s the captured session id, continuing the same
// conversation with full prior context. Reuses the shared Composer, then jumps to the new run's live
// output (onRunStarted). The agent is the one the run actually ran under, never the global pref
// (#831): resume is per-agent, so a session id means nothing to a different agent's CLI. Only
// rendered when the run has a session id.
export function RunResumeChat({
  projectId,
  runId,
  sessionId,
  driver,
  files,
  addContext,
  removeContext,
  onRunStarted,
  sessionName,
  outcome,
}: {
  projectId: string
  /** The run being continued (#762), so the follow-up reopens it instead of starting a new one. */
  runId: string
  /** The finished run's agent session id, to resume. */
  sessionId: string
  /** The driver that ran it, so the continuation resumes on the same agent (#831). */
  driver?: string | undefined
  files: string[]
  addContext: (path: string) => void
  /** Drop a path from the run Context when its chip leaves the editor (#948). */
  removeContext?: ((path: string) => void) | undefined
  onRunStarted: (intent: string, runId?: string) => void
  /** This session's name (#874), so a preset launched here targets it by default. */
  sessionName?: string | undefined
  /** How the run ended (#948), so the note does not call a crash "ended". */
  outcome?: RunOutcome | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const { busy, error, start } = useStartRun()

  const send = async (text: string): Promise<void> => {
    if (busy) return
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
        resumeSession: sessionId,
        // Continue this run rather than opening a new row (#762): the follow-up writes into the
        // same run, on the same branch, so one thing you asked for stays one entry.
        continueRunId: runId,
        ...(agent && agent !== 'claude' ? { agent } : {}),
      },
      'Failed to continue the session.',
    )
    if (result) {
      composerRef.current?.clear()
      onRunStarted(text, result.runId) // select the run we just started (#761)
    }
  }

  return (
    <div className="border-t border-border p-2">
      <p className="mb-2 text-xs text-muted-foreground">
        {outcome && !outcome.ok && !outcome.stopped
          ? 'Session failed — your next message resumes it where it stopped.'
          : outcome?.stopped
            ? 'Session stopped — your next message resumes it.'
            : 'Session ended — your next message continues it.'}
      </p>
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        onSubmit={send}
        busy={busy}
        submitLabel="Send"
        submitBusyLabel="Resuming…"
        showAgentModel={false}
        sessionName={sessionName}
        placeholder="Message the session to continue it…  ( / commands · < tags · @ projects · # files )"
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
