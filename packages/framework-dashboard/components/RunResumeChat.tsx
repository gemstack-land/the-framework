import { useRef, useState } from 'react'
import { Composer, type ComposerHandle } from './Composer.js'
import { sendStart } from '../server/control.telefunc.js'
import { usePreferences } from '../lib/preferences.js'

// The finished-run composer (#720): keep talking to a run that has ended. A live run drains
// messages in-process (RunChat + sendMessage), but a finished run has no process — so sending here
// spins a FRESH run whose opening prompt `--resume`s the captured session id, continuing the same
// conversation with full prior context. Reuses the shared Composer, then jumps to the new run's live
// output (onRunStarted). Options come from the shared prefs, same as the launcher; the agent should
// match the one the run used (resume is per-agent). Only rendered when the run has a session id.
export function RunResumeChat({
  projectId,
  sessionId,
  files,
  addContext,
  onRunStarted,
}: {
  projectId: string
  /** The finished run's agent session id, to resume. */
  sessionId: string
  files: string[]
  addContext: (path: string) => void
  onRunStarted: (intent: string) => void
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preferences = usePreferences()

  const send = async (text: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // A continuation is a `prompt` run seeded with the finished run's session id (#720). Carry the
      // model/agent from the shared prefs (resume is per-agent, so keep the same one the run used);
      // the system-prompt options are moot here — the resumed transcript keeps its own framing.
      const model = preferences.model ?? ''
      const agent = preferences.agent ?? 'claude'
      const result = await sendStart(projectId, text, 'prompt', {
        resumeSession: sessionId,
        ...(model ? { model } : {}),
        ...(agent && agent !== 'claude' ? { agent } : {}),
      })
      if (result.ok) {
        composerRef.current?.clear()
        onRunStarted(text) // jump to the new (resumed) run's live output
      } else {
        setError(result.busy ? 'A run is already active for this project.' : result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue the run.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-border p-2">
      <p className="mb-2 text-xs text-muted-foreground">Run ended — your next message continues it.</p>
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        onSubmit={send}
        busy={busy}
        submitLabel="Send"
        submitBusyLabel="Resuming…"
        placeholder="Message the run to continue it…  ( / commands · < tags · @ projects · # files )"
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
