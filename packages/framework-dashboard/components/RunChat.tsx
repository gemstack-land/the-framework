import { useRef, useState } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { Composer, type ComposerHandle } from './Composer.js'
import { sendMessage } from '../server/control.telefunc.js'
import { onProjects } from '../server/projects.telefunc.js'
import { useLoaded } from '../lib/use-async.js'

// The live-chat composer (#714/#721): send more messages to a running run. Reuses the same shared
// Composer the launcher uses, so `/` presets, `<` tags, and `@`/`#` mentions work here too, plus the
// agent/model + options controls. On submit it writes a `message` control entry that the run drains
// between turns (continuing the same session via --resume); the agent/model + options edit the
// Global preferences (the defaults for the next run) — a mid-run message itself carries no options.
// Only rendered inside RunLive, i.e. while the run is running — a finished run replays without it.
export function RunChat({
  projectId,
  files,
  addContext,
}: {
  projectId: string
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** Add a path to the run Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
}) {
  const composerRef = useRef<ComposerHandle>(null)
  const [sending, setSending] = useState(false)
  // The registered projects for the `@` picker — the same list the launcher reads.
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])

  const send = async (text: string): Promise<void> => {
    if (sending) return
    setSending(true)
    try {
      await sendMessage(projectId, text)
      composerRef.current?.clear()
    } catch {
      // Leave the text in place so the user can retry; the run may have just ended.
    } finally {
      setSending(false)
      composerRef.current?.focus()
    }
  }

  return (
    <div className="border-t border-border p-3">
      <Composer
        ref={composerRef}
        projects={projects}
        files={files}
        addContext={addContext}
        onSubmit={send}
        busy={sending}
        submitLabel="Send"
        submitBusyLabel="Sending…"
        placeholder="Message the run…  ( / commands · < tags · @ projects · # files )"
      />
    </div>
  )
}
