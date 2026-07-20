import { useRef, useState } from 'react'
import { Composer, type ComposerHandle } from './Composer.js'
import { sendMessage } from '../server/control.telefunc.js'

// The live-chat composer (#714/#721): send more messages to a running run. Reuses the same shared
// Composer the launcher uses, so `/` presets, `<` tags, and `@`/`#` mentions work here too. On
// submit it writes a `message` control entry that the run drains between turns, continuing the same
// session via --resume. No agent/model select (#831): the run's driver is created once at spawn and
// a message carries only text, so the select could not change this session, only the next one.
// Only rendered inside RunLive, i.e. while the run is running — a finished run replays without it.
export function RunChat({
  projectId,
  runId,
  files,
  addContext,
  sessionName,
}: {
  projectId: string
  /** Which run the message goes to (#749); absent falls back to the project's control log. */
  runId?: string | null | undefined
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** Add a path to the run Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** This session's name (#874), so a preset launched here targets it by default. */
  sessionName?: string | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const [sending, setSending] = useState(false)

  const send = async (text: string): Promise<void> => {
    if (sending) return
    setSending(true)
    try {
      await sendMessage(projectId, text, runId ?? undefined)
      composerRef.current?.clear()
    } catch {
      // Leave the text in place so the user can retry; the run may have just ended.
    } finally {
      setSending(false)
      composerRef.current?.focus()
    }
  }

  return (
    <div className="border-t border-border p-2">
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        onSubmit={send}
        busy={sending}
        submitLabel="Send"
        submitBusyLabel="Sending…"
        showAgentModel={false}
        sessionName={sessionName}
        placeholder="Message the session…  ( / commands · < tags · @ projects · # files )"
      />
    </div>
  )
}
