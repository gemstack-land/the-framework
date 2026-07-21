import { useRef } from 'react'
import { Composer, type ComposerHandle } from './Composer.js'
import { useStartRun } from '../lib/use-start-run.js'

// The run's driver reports itself by driver name; `--agent` takes the agent name (#831).
const AGENT_OF_DRIVER: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' }

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
  onRunStarted,
  sessionName,
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
  onRunStarted: (intent: string, runId?: string) => void
  /** This session's name (#874), so a preset launched here targets it by default. */
  sessionName?: string | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const { busy, error, start } = useStartRun()

  const send = async (text: string): Promise<void> => {
    if (busy) return
    // A continuation is a `prompt` run seeded with the finished run's session id (#720). It
    // resumes on the run's own agent; the model and the system-prompt options are moot here, since
    // the resumed transcript keeps the framing and model it already had.
    const agent = driver ? AGENT_OF_DRIVER[driver] : undefined
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
      <p className="mb-2 text-xs text-muted-foreground">Session ended — your next message continues it.</p>
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
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
