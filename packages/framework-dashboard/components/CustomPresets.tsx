import { useState } from 'react'
import type { CustomPreset } from '@gemstack/framework'
import { Plus, X } from 'lucide-react'
import { Button } from './ui/button.js'

// User-defined presets (#626): the user's own saved prompts, shown beside the built-in preset
// buttons in the Start form. A preset is just a label + a prompt; clicking it loads the prompt
// into the editor (run as a `prompt` kind, same as a built-in). Rom + nitedani keep hand-crafting
// high-signal prompts — this lets them save and re-run them. Persisted in the daemon preferences.

const LABEL_MAX = 80

/** A fresh id for a saved preset. `crypto.randomUUID` is present in the dashboard's browser + prerender runtime. */
function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`
}

export function CustomPresets({
  presets,
  currentPrompt,
  busy,
  onUse,
  onChange,
}: {
  presets: CustomPreset[]
  /** The Start form's current textarea text, so "Save as preset" can capture what you just wrote. */
  currentPrompt: string
  busy: boolean
  /** Load a saved preset's prompt into the editor. */
  onUse: (preset: CustomPreset) => void
  /** Persist the next preset list (add / delete). */
  onChange: (next: CustomPreset[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [prompt, setPrompt] = useState('')

  const openAdd = () => {
    setLabel('')
    setPrompt(currentPrompt) // prefill with what's in the editor — the common "save what I just wrote" path
    setAdding(true)
  }

  const save = () => {
    const trimmedLabel = label.trim()
    const trimmedPrompt = prompt.trim()
    if (!trimmedLabel || !trimmedPrompt) return
    onChange([...presets, { id: newId(), label: trimmedLabel, prompt: trimmedPrompt }])
    setAdding(false)
  }

  const remove = (id: string) => onChange(presets.filter(p => p.id !== id))

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map(preset => (
          <span key={preset.id} className="group inline-flex items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className="rounded-r-none border-r-0"
              title="Load this saved prompt"
              onClick={() => onUse(preset)}
            >
              {preset.label}
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(preset.id)}
              title={`Delete "${preset.label}"`}
              aria-label={`Delete preset ${preset.label}`}
              className="flex h-8 items-center rounded-md rounded-l-none border border-border px-1 text-muted-foreground hover:text-red-500 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {!adding && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={openAdd}
            title="Save a prompt as a reusable preset"
            className="text-muted-foreground"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Preset
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
          <input
            type="text"
            value={label}
            maxLength={LABEL_MAX}
            placeholder="Preset name"
            disabled={busy}
            onChange={e => setLabel(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
          <textarea
            value={prompt}
            placeholder="The prompt this preset runs…"
            disabled={busy}
            rows={4}
            onChange={e => setPrompt(e.target.value)}
            className="resize-y rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy || !label.trim() || !prompt.trim()} onClick={save}>
              Save preset
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
