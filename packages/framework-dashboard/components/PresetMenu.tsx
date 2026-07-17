import { useState } from 'react'
import type { CustomPreset } from '@gemstack/framework'
import { ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { Button, buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from './ui/dropdown-menu.js'

// One "Presets" dropdown (#649) replacing the row of preset buttons + the "+ Preset" control.
// It lists the built-in presets, the user's saved presets (#626, each removable), and a
// "New preset…" entry that opens an inline create panel. Selecting any preset loads its prompt
// into the editor; the run then goes verbatim as a `prompt` kind (unchanged behaviour).

const LABEL_MAX = 80

/** A built-in preset: a label and a function that renders its prompt template. */
export interface BuiltInPreset {
  id: string
  label: string
  render: () => string
}

/** A fresh id for a saved preset. `crypto.randomUUID` is present in the browser + prerender runtime. */
function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`
}

export function PresetMenu({
  builtIns,
  customPresets,
  currentPrompt,
  busy,
  onLoadBuiltIn,
  onUseCustom,
  onChangeCustom,
}: {
  builtIns: BuiltInPreset[]
  customPresets: CustomPreset[]
  /** The editor's current text, so "New preset" can capture what you just wrote. */
  currentPrompt: string
  busy: boolean
  /** Load a built-in preset's rendered template into the editor. */
  onLoadBuiltIn: (preset: BuiltInPreset) => void
  /** Load a saved preset's prompt into the editor. */
  onUseCustom: (preset: CustomPreset) => void
  /** Persist the next saved-preset list (add / delete). */
  onChangeCustom: (next: CustomPreset[]) => void
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
    onChangeCustom([...customPresets, { id: newId(), label: trimmedLabel, prompt: trimmedPrompt }])
    setAdding(false)
  }

  const remove = (id: string) => onChangeCustom(customPresets.filter(p => p.id !== id))

  return (
    <div className="flex flex-col gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          disabled={busy}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        >
          Presets
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Built-in</DropdownMenuLabel>
            {builtIns.map(p => (
              <DropdownMenuItem key={p.id} onClick={() => onLoadBuiltIn(p)}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>

          {customPresets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Saved</DropdownMenuLabel>
                {customPresets.map(preset => (
                  <DropdownMenuItem key={preset.id} onClick={() => onUseCustom(preset)} className="pr-1">
                    <span className="flex-1 truncate">{preset.label}</span>
                    <button
                      type="button"
                      // Delete in place without loading the preset or closing the menu.
                      onClick={e => {
                        e.stopPropagation()
                        e.preventDefault()
                        remove(preset.id)
                      }}
                      title={`Delete "${preset.label}"`}
                      aria-label={`Delete preset ${preset.label}`}
                      className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={event => {
              event.preventDefault() // keep focus flow sane; open the inline panel below
              openAdd()
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New preset…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
