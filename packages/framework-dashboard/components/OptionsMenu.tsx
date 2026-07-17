import type { Preferences } from '@gemstack/framework'
import { Settings } from 'lucide-react'
import { updatePreferences } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
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
}

function setOption(key: keyof Preferences, checked: boolean) {
  updatePreferences({ [key]: checked } as Partial<Preferences>)
}

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
}: {
  options: OptionRow[]
  ecoOptions: OptionRow[]
  /** Whether Eco's sub-drops apply right now (Eco on and not disabled by Vanilla). */
  showEco: boolean
  busy: boolean
}) {
  const activeCount = options.filter(o => o.checked && !o.disabled).length
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
            <OptionLabel label={o.label} description={o.description} />
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
                <OptionLabel label={o.label} description={o.description} />
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
