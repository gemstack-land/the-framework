import type { Preferences } from '@gemstack/framework'
import { Settings, Check } from 'lucide-react'
import { updatePreferences } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
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

// Moved to ui/option-label.tsx (#948) so menus without preference wiring can share it;
// re-exported to keep this module the import site the other menus already use.
import { OptionLabel } from './ui/option-label.js'
export { OptionLabel }

/** Where a run executes (#1050). `local` runs on this device; `actions` on a GitHub Actions runner. */
export type RunTarget = 'local' | 'actions'

/** The single-select "Run on" control (#1050): the driver axis, at the top of the gear. */
export type RunTargetControl = {
  value: RunTarget
  onChange: (value: RunTarget) => void
}

// The run targets the gear offers (#1050). A single-select modeled on the agent tree (Check-marked
// rows), not the boolean OptionRow. "Claude web" is a disabled placeholder for the sibling axis in
// #1049 that has not shipped yet, so the menu shows where this is going without promising it.
const RUN_TARGET_ROWS: { value: RunTarget; label: string; description: string }[] = [
  { value: 'local', label: 'Current device', description: 'Run on this machine, as today.' },
  { value: 'actions', label: 'GitHub Actions', description: 'Run on a fresh GitHub Actions runner.' },
]

function RunTargetSub({ control, busy }: { control: RunTargetControl; busy: boolean }) {
  const current = RUN_TARGET_ROWS.find(r => r.value === control.value) ?? RUN_TARGET_ROWS[0]!
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={busy}>
        <span className="flex-1">Run on</span>
        <span className="text-muted-foreground">{current.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {RUN_TARGET_ROWS.map(row => (
          <DropdownMenuItem key={row.value} className="items-start" onClick={() => control.onChange(row.value)}>
            <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', row.value === control.value ? 'opacity-100' : 'opacity-0')} />
            <OptionLabel label={row.label} description={row.description} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem disabled className="items-start">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-0" />
          <OptionLabel label="Claude web" description="Coming soon." />
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** One preference checkbox row. The disabled reason rides the description (the `title`
 * tooltip is suppressed on disabled dropdown items), so a greyed row isn't a mystery. */
function OptionCheckboxRow({ row, busy, indent = false }: { row: OptionRow; busy: boolean; indent?: boolean }) {
  return (
    <DropdownMenuCheckboxItem
      checked={row.checked}
      disabled={busy || !!row.disabled}
      onCheckedChange={checked => setOption(row.key, checked)}
      title={row.title}
      className={indent ? 'items-start pl-8' : 'items-start'}
    >
      <OptionLabel
        label={row.label}
        description={row.disabled && row.disabledReason ? [row.description, `— ${row.disabledReason}`].filter(Boolean).join(' ') : row.description}
      />
    </DropdownMenuCheckboxItem>
  )
}

export function OptionsMenu({
  options,
  ecoOptions,
  showEco,
  busy,
  label = 'Session options',
  runTarget,
}: {
  options: OptionRow[]
  ecoOptions: OptionRow[]
  /** Whether Eco's sub-drops apply right now (Eco on and not disabled by Vanilla). */
  showEco: boolean
  busy: boolean
  /** The trigger's name. In-session composers pass no run options (#833), so theirs says
   *  "Preferences" rather than promising session control it does not have. */
  label?: string
  /** The "Run on" driver axis (#1050), at the top of the gear. Omitted in-session, where the
   *  target is baked in at spawn — same as the agent select. */
  runTarget?: RunTargetControl | undefined
}) {
  const activeCount = options.filter(o => o.checked && !o.disabled).length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        title={activeCount > 0 ? `${label} — ${activeCount} on` : label}
        aria-label={label}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative h-8 w-8')}
      >
        <Settings className="h-4 w-4" />
        {activeCount > 0 && (
          // A small presence dot (#1046): that some options are on is the signal; the exact count
          // is one click away in the menu, so the number was noise.
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--color-primary)]" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[19rem] max-w-[22rem]">
        {runTarget && (
          <>
            <RunTargetSub control={runTarget} busy={busy} />
            {options.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {options.map(o => (
          <OptionCheckboxRow key={o.key} row={o} busy={busy} />
        ))}
        {showEco && (
          <>
            <DropdownMenuSeparator />
            {ecoOptions.map(o => (
              <OptionCheckboxRow key={o.key} row={o} busy={busy} indent />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
