import type { Preferences } from '@gemstack/framework'
import { ChevronDown } from 'lucide-react'
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
  checked: boolean
  /** Disabled beyond the form-wide busy flag (e.g. Eco has nothing to trim under Vanilla). */
  disabled?: boolean
}

function setOption(key: keyof Preferences, checked: boolean) {
  updatePreferences({ [key]: checked } as Partial<Preferences>)
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
        title="Run options"
        className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'font-normal')}
      >
        Options
        {activeCount > 0 && (
          <span className="rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] leading-4 text-[var(--color-primary-foreground)]">
            {activeCount}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map(o => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={o.checked}
            disabled={busy || !!o.disabled}
            onCheckedChange={checked => setOption(o.key, checked)}
            title={o.title}
          >
            {o.label}
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
                className="pl-8"
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
