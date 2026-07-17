import type { CustomPreset } from '@gemstack/framework'
import { ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from './ui/dropdown-menu.js'

// The "Presets" dropdown (#649): built-in presets, the user's saved presets (#626, each
// removable), and a "New preset…" entry. Selecting a preset loads its prompt into the editor;
// the run then goes verbatim as a `prompt` kind. The create panel is a sibling the parent owns
// (PresetCreatePanel) so it can be full-width, not squeezed under this dropdown button.

/** A built-in preset: a label and a function that renders its prompt template. */
export interface BuiltInPreset {
  id: string
  label: string
  render: () => string
}

export function PresetMenu({
  builtIns,
  customPresets,
  busy,
  onLoadBuiltIn,
  onUseCustom,
  onDeleteCustom,
  onNewPreset,
}: {
  builtIns: BuiltInPreset[]
  customPresets: CustomPreset[]
  busy: boolean
  /** Load a built-in preset's rendered template into the editor. */
  onLoadBuiltIn: (preset: BuiltInPreset) => void
  /** Load a saved preset's prompt into the editor. */
  onUseCustom: (preset: CustomPreset) => void
  /** Delete a saved preset by id. */
  onDeleteCustom: (id: string) => void
  /** Open the create panel (owned by the parent so it can render full-width). */
  onNewPreset: () => void
}) {
  return (
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
                      onDeleteCustom(preset.id)
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
        <DropdownMenuItem onClick={() => onNewPreset()}>
          <Plus className="h-3.5 w-3.5" />
          New preset…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
