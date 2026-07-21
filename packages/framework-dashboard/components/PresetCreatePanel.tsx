import { useState, type KeyboardEvent } from 'react'
import type { CustomPreset } from '@gemstack/framework'
import { Button } from './ui/button.js'

// The "New preset" create panel (#649/#626), lifted out of the Presets dropdown so it renders
// full-width under the controls row. Prefills the prompt from the editor's current text — the
// common "save what I just wrote" path. A preset is just a label + a prompt.

const LABEL_MAX = 80

/** A fresh id for a saved preset. `crypto.randomUUID` is present in the browser + prerender runtime. */
function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`
}

export function PresetCreatePanel({
  currentPrompt,
  busy,
  onSave,
  onCancel,
}: {
  /** The editor's current text, prefilled so you can save what you just wrote. */
  currentPrompt: string
  busy: boolean
  onSave: (preset: CustomPreset) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState('')
  const [prompt, setPrompt] = useState(currentPrompt)

  const save = () => {
    const trimmedLabel = label.trim()
    const trimmedPrompt = prompt.trim()
    if (!trimmedLabel || !trimmedPrompt) return
    onSave({ id: newId(), label: trimmedLabel, prompt: trimmedPrompt })
  }

  // Keyboard parity with the composer (#948): Esc cancels, ⌘/Ctrl+Enter saves.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="mt-1.5 flex w-full flex-col gap-1.5 rounded-md border border-border p-2" onKeyDown={onKeyDown}>
      <input
        type="text"
        value={label}
        maxLength={LABEL_MAX}
        placeholder="Preset name"
        disabled={busy}
        autoFocus
        onChange={e => setLabel(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
      <textarea
        value={prompt}
        placeholder="The prompt this preset runs…"
        disabled={busy}
        rows={4}
        onChange={e => setPrompt(e.target.value)}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={busy || !label.trim() || !prompt.trim()} onClick={save}>
          Save preset
        </Button>
      </div>
    </div>
  )
}
