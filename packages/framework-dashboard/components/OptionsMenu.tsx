import type { Preferences, CustomPreset } from '@gemstack/framework'
import { Settings, Check, Monitor, Sun, Moon, X, type LucideIcon } from 'lucide-react'
import { updatePreferences, type ThemePreference } from '../lib/preferences.js'
import type { EditorInfo } from '../server/preferences.telefunc.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

// The Global options (#314) as one "Options" checkbox dropdown (#654), replacing the row of
// checkboxes. Each item writes its preference straight through; the menu stays open so several
// can be flipped at once. Eco's sub-drops appear (indented) when Eco is on.

/** One Global-option row: a preference key plus how its checkbox reads. */
export type OptionRow = {
  key: keyof Preferences
  label: string
  title: string
  /** A short one-line summary shown under the label (#654). */
  description?: string
  checked: boolean
  /** Disabled beyond the form-wide busy flag (e.g. Eco has nothing to trim under Vanilla). */
  disabled?: boolean
  /** Why it's disabled, shown in the description so a greyed row isn't a mystery (the `title`
   * tooltip is suppressed on disabled dropdown items). Only rendered while {@link disabled}. */
  disabledReason?: string
}

function setOption(key: keyof Preferences, checked: boolean) {
  updatePreferences({ [key]: checked } as Partial<Preferences>)
}

/** The theme choices (#725), in trigger order; `system` is the default. */
const THEME_OPTIONS: { value: ThemePreference; label: string; description: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', description: 'Follow your OS setting', icon: Monitor },
  { value: 'light', label: 'Light', description: '', icon: Sun },
  { value: 'dark', label: 'Dark', description: '', icon: Moon },
]

/** An option's label with a short one-line description under it (#654). */
function OptionLabel({ label, description }: { label: string; description?: string | undefined }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="leading-tight">{label}</span>
      {description && <span className="text-xs font-normal text-[var(--color-muted-foreground)]">{description}</span>}
    </span>
  )
}

export function OptionsMenu({
  options,
  ecoOptions,
  showEco,
  busy,
  editor,
  editors,
  onEditorChange,
  theme,
  onThemeChange,
  customPresets = [],
  onDeleteCustomPreset = () => {},
}: {
  options: OptionRow[]
  ecoOptions: OptionRow[]
  /** Whether Eco's sub-drops apply right now (Eco on and not disabled by Vanilla). */
  showEco: boolean
  busy: boolean
  /** The current preferred-editor CLI (#727), or undefined for the default. */
  editor: string | undefined
  /** The editors detected on the daemon's machine; empty on a public host. */
  editors: EditorInfo[]
  /** Pick an editor CLI, or `undefined` to fall back to `$FRAMEWORK_EDITOR` / `code`. */
  onEditorChange: (editor: string | undefined) => void
  /** The current dashboard theme (#725). */
  theme: ThemePreference
  /** Pick a new theme; persisted by the caller. */
  onThemeChange: (theme: ThemePreference) => void
  /** The user's saved presets (#626); managed here now the Presets dropdown is gone (#722). */
  customPresets?: CustomPreset[]
  /** Delete a saved preset by id. */
  onDeleteCustomPreset?: (id: string) => void
}) {
  const activeCount = options.filter(o => o.checked && !o.disabled).length
  // Detected editors, plus the stored one as a "custom" row when it isn't auto-detected (e.g. a
  // hand-set $FRAMEWORK_EDITOR), so the current choice always shows even if we couldn't find it.
  const editorRows: EditorInfo[] =
    editor && !editors.some(e => e.bin === editor) ? [...editors, { bin: editor, label: editor }] : editors
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        title={activeCount > 0 ? `Run options — ${activeCount} on` : 'Run options'}
        aria-label="Run options"
        className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm' }), 'relative')}
      >
        <Settings className="h-4 w-4" />
        {activeCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-medium leading-none text-[var(--color-primary-foreground)]">
            {activeCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[19rem] max-w-[22rem]">
        {options.map(o => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={o.checked}
            disabled={busy || !!o.disabled}
            onCheckedChange={checked => setOption(o.key, checked)}
            title={o.title}
            className="items-start"
          >
            <OptionLabel
              label={o.label}
              description={o.disabled && o.disabledReason ? [o.description, `— ${o.disabledReason}`].filter(Boolean).join(' ') : o.description}
            />
          </DropdownMenuCheckboxItem>
        ))}
        {showEco && (
          <>
            <DropdownMenuSeparator />
            {ecoOptions.map(o => (
              <DropdownMenuCheckboxItem
                key={o.key}
                checked={o.checked}
                disabled={busy}
                onCheckedChange={checked => setOption(o.key, checked)}
                title={o.title}
                className="items-start pl-8"
              >
                <OptionLabel
              label={o.label}
              description={o.disabled && o.disabledReason ? [o.description, `— ${o.disabledReason}`].filter(Boolean).join(' ') : o.description}
            />
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Open in editor</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={busy}
            closeOnClick={false}
            onClick={() => onEditorChange(undefined)}
            title="Use $FRAMEWORK_EDITOR, or VS Code"
            className="items-start"
          >
            <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor ? 'opacity-0' : 'opacity-100')} />
            <OptionLabel label="Default" description="$FRAMEWORK_EDITOR, or code" />
          </DropdownMenuItem>
          {editorRows.map(e => (
            <DropdownMenuItem
              key={e.bin}
              disabled={busy}
              closeOnClick={false}
              onClick={() => onEditorChange(e.bin)}
              title={`Open projects in ${e.label} (${e.bin})`}
              className="items-start"
            >
              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor === e.bin ? 'opacity-100' : 'opacity-0')} />
              <OptionLabel label={e.label} description={e.bin} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          {THEME_OPTIONS.map(t => {
            const Icon = t.icon
            return (
              <DropdownMenuItem
                key={t.value}
                disabled={busy}
                // Keep the menu open so the theme visibly changes underneath the pick.
                closeOnClick={false}
                onClick={() => onThemeChange(t.value)}
                title={`${t.label} theme`}
                className="items-start"
              >
                <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', t.value === theme ? 'opacity-100' : 'opacity-0')} />
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                <OptionLabel label={t.label} description={t.description || undefined} />
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
        {customPresets.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Your presets</DropdownMenuLabel>
            {customPresets.map(p => (
              // Loading moved to the `/` menu (#722); this row is manage-only, so its sole action is
              // the trailing delete. Keep the menu open so several can be removed in one go.
              <DropdownMenuItem key={p.id} closeOnClick={false} className="items-center gap-2">
                <span className="flex-1 truncate">{p.label}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeleteCustomPreset(p.id)}
                  title={`Delete "${p.label}"`}
                  aria-label={`Delete preset ${p.label}`}
                  className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
