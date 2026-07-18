import { useRef, useState } from 'react'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { Button } from './ui/button.js'
import { sendMessage } from '../server/control.telefunc.js'

// The live-chat composer (#714): send more messages to a running run. Reuses the same Tiptap
// PromptEditor the launcher uses, so `/` actions and `<` tags work here too; on submit it writes
// a `message` control entry that the run drains between turns (continuing the same session via
// --resume). Only rendered inside RunLive, i.e. while the run is running — a finished run replays
// without it. Presets/mentions are dropped here (a mid-run message is plain instruction).
export function RunChat({ projectId }: { projectId: string }) {
  const editorRef = useRef<PromptEditorHandle>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    try {
      await sendMessage(projectId, message)
      editorRef.current?.clear()
      setText('')
    } catch {
      // Leave the text in place so the user can retry; the run may have just ended.
    } finally {
      setSending(false)
      editorRef.current?.focus()
    }
  }

  return (
    <div className="border-t border-border p-3">
      <PromptEditor
        ref={editorRef}
        projects={[]}
        presets={[]}
        onChange={setText}
        onSubmit={send}
        placeholder="Message the run…  (Cmd/Ctrl+Enter to send)"
        disabled={sending}
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={send} disabled={!text.trim() || sending}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
