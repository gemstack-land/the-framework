import { useRef, useState } from 'react'
import { Composer, type ComposerHandle } from './Composer.js'
import { sendMessage } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { useStartRun } from '../lib/use-start-run.js'

// The live-chat composer (#714/#721): send more messages to a running run. Reuses the same shared
// Composer the launcher uses, so `/` presets, `<` tags, and `@`/`#` mentions work here too. On
// submit it writes a `message` control entry that the run drains between turns, continuing the same
// session via --resume. No agent/model select (#831): the run's driver is created once at spawn and
// a message carries only text, so the select could not change this session, only the next one.
// Only rendered inside RunLive, i.e. while the run is running — a finished run replays without it.
// The one exception to "everything typed here goes to this session" is a new-session preset (#959),
// which starts its own run instead.
export function RunChat({
  projectId,
  runId,
  files,
  addContext,
  removeContext,
  sessionName,
  onRunStarted,
}: {
  projectId: string
  /** Which run the message goes to (#749); absent falls back to the project's control log. */
  runId?: string | null | undefined
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** Add a path to the run Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Drop a path from the run Context when its chip leaves the editor (#948). */
  removeContext?: ((path: string) => void) | undefined
  /** This session's name (#874), so a preset launched here targets it by default. */
  sessionName?: string | undefined
  /** Jump to the run a new-session preset just started (#959). */
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const { busy, error, run } = useAction()
  // A new-session preset does not go into this session at all (#959): it spawns its own run, the
  // same way the launcher does, so it gets its own worktree, branch and transcript.
  const { busy: starting, error: startError, start } = useStartRun()
  // The last message that went through: a queued control entry is invisible until the agent
  // drains it between turns, so without this the send looked like nothing happened (#948).
  const [queued, setQueued] = useState<string | null>(null)

  const send = async (text: string, _kind: 'build' | 'prompt', opts: { newSession: boolean }): Promise<void> => {
    if (busy || starting) return
    if (opts.newSession) {
      const started = await start(projectId, text, 'prompt', {})
      if (started) {
        composerRef.current?.clear()
        onRunStarted?.(text, started.runId)
      }
      composerRef.current?.focus()
      return
    }
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
  }

  return (
    <div className="border-t border-border p-2">
      {queued && !error && (
        <p role="status" className="mb-1 truncate px-2 text-xs text-muted-foreground">
          Queued — the session reads it between turns: &ldquo;{queued}&rdquo;
        </p>
      )}
      {(error ?? startError) && <p role="alert" className="mb-1 px-2 text-xs text-red-500">{error ?? startError}</p>}
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        onSubmit={send}
        busy={busy || starting}
        submitLabel="Send"
        submitBusyLabel="Sending…"
        showAgentModel={false}
        inSession
        sessionName={sessionName}
        placeholder="Message the session…  ( / commands · < tags · @ projects · # files )"
      />
    </div>
  )
}
