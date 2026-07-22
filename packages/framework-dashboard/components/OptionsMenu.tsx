import type { Preferences } from '@gemstack/framework'
import { Settings, Check, Laptop, MonitorSmartphone, Plus } from 'lucide-react'
import { updatePreferences } from '../lib/preferences.js'
import type { ConnectionProfile } from '../lib/profiles.js'
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

/**
 * The "A device I have" section of the "Run on" sub (#1052). A device is a CONNECTION, not a driver:
 * the driver rows above rewrite a preference, these NAVIGATE the browser to another daemon's origin.
 * That is the divergence the gear holds in one list — driver rows call `updatePreferences` (per-run),
 * device rows call `onConnect`/`onConnectLocal` (a page navigation carrying the token).
 */
export type ConnectionControl = {
  /** The saved remote daemons this browser can hop to. */
  profiles: ConnectionProfile[]
  /** `window.location.origin`, to mark the daemon the dashboard is on now. */
  currentUrl: string | null
  /** Whether the current origin is loopback, so "Local" is the checked row. */
  isLocal: boolean
  onConnect: (profile: ConnectionProfile) => void
  onConnectLocal: () => void
  onAddDevice: () => void
}

// The run targets the gear offers (#1050). A single-select modeled on the agent tree (Check-marked
// rows), not the boolean OptionRow. "Claude web" is a disabled placeholder for the sibling axis in
// #1049 that has not shipped yet, so the menu shows where this is going without promising it.
const RUN_TARGET_ROWS: { value: RunTarget; label: string; description: string }[] = [
  { value: 'local', label: 'Current device', description: 'Run on this machine, as today.' },
  { value: 'actions', label: 'GitHub Actions', description: 'Run on a fresh GitHub Actions runner.' },
]

function RunTargetSub({ control, connection, busy }: { control: RunTargetControl; connection?: ConnectionControl | undefined; busy: boolean }) {
  const current = RUN_TARGET_ROWS.find(r => r.value === control.value) ?? RUN_TARGET_ROWS[0]!
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={busy}>
        <span className="flex-1">Run on</span>
        <span className="text-muted-foreground">{current.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {/* Driver rows (#1050): a per-run preference, written straight through. */}
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
        {connection && <ConnectionSection connection={connection} busy={busy} />}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** The "A device I have" rows (#1052). Unlike the driver rows above, a click here NAVIGATES the
 * browser to that daemon's origin (carrying the token) rather than writing a preference. */
function ConnectionSection({ connection, busy }: { connection: ConnectionControl; busy: boolean }) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>A device I have</DropdownMenuLabel>
        <DropdownMenuItem className="items-start" onClick={() => connection.onConnectLocal()}>
          <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', connection.isLocal ? 'opacity-100' : 'opacity-0')} />
          <Laptop className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <OptionLabel label="Local" description="This machine's own daemon." />
        </DropdownMenuItem>
        {connection.profiles.map(profile => (
          <DropdownMenuItem key={profile.id} className="items-start" onClick={() => connection.onConnect(profile)}>
            <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', !connection.isLocal && profile.url === connection.currentUrl ? 'opacity-100' : 'opacity-0')} />
            <MonitorSmartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <OptionLabel label={profile.label} description={profile.url} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className="items-start" disabled={busy} onClick={() => connection.onAddDevice()}>
          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <OptionLabel label="Add a device…" description="Paste the URL a box prints on its network bind." />
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
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
  connection,
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
  /** The saved-devices connection section (#1052), rendered inside the "Run on" sub under the
   *  driver rows. Rides the same sub as runTarget, so it shows only where that does. */
  connection?: ConnectionControl | undefined
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
            <RunTargetSub control={runTarget} connection={connection} busy={busy} />
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
