import type { CustomPreset } from '@gemstack/framework'
import { SquareSlash, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { OptionLabel } from './ui/option-label.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

/** A built-in preset as the composer prepares it: render() gives the prompt for this surface. */
export interface PresetEntry {
  id: string
  label: string
  render: () => string
  tooltip?: string | undefined
  /** Runs in a session of its own, even when loaded from inside one (#959). */
  newSession?: boolean | undefined
}

// The visible face of the presets (#948). Loading used to live only behind typing `/` in the
// editor — with the preset cards and dropdown gone (#722), an empty box gave a first-time user
// no sign that 13 launcher presets exist — and deleting lived in the options gear, a different
// menu. This button is the one surface that loads, creates, and deletes; the `/` menu stays as
// the fast path for those who know it.
export function PresetsMenu({
  presets,
  customPresets,
  busy,
  onLoad,
  onNew,
  onDelete,
}: {
  presets: PresetEntry[]
  customPresets: CustomPreset[]
  busy: boolean
  /** Load a preset's prompt into the editor. `newSession` marks the ones that never append to
   *  the open session (#959); a saved preset is always a plain load. */
  onLoad: (text: string, label: string, newSession?: boolean) => void
  /** Open the create panel; absent where no panel renders. */
  onNew?: (() => void) | undefined
  /** Delete a saved preset by id. */
  onDelete: (id: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        aria-label="Presets"
        title="Load a preset prompt — also available by typing / in the editor"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'h-8 w-8')}
      >
        <SquareSlash className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem] max-w-[20rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Presets</DropdownMenuLabel>
          {presets.map(p => (
            <DropdownMenuItem
              key={p.id}
              disabled={busy}
              onClick={() => onLoad(p.render(), p.label, p.newSession)}
              {...(p.tooltip ? { title: p.tooltip } : {})}
              className="items-start"
            >
              <OptionLabel label={p.label} description={`/${p.id}`} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {customPresets.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Your presets</DropdownMenuLabel>
            {customPresets.map(p => (
              <DropdownMenuItem key={p.id} disabled={busy} onClick={() => onLoad(p.prompt, p.label)} className="items-center gap-2">
                <span className="flex-1 truncate">{p.label}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={e => {
                    // Delete, not load — keep the row's own click out of it.
                    e.stopPropagation()
                    onDelete(p.id)
                  }}
                  title={`Delete "${p.label}"`}
                  aria-label={`Delete preset ${p.label}`}
                  className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {onNew && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onClick={onNew}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New preset…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
