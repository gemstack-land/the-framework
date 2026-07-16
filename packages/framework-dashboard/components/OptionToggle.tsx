import type { Preferences } from '@gemstack/framework'
import { updatePreferences } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'

/** One Global-option row (#314): a preference key plus how its checkbox reads. */
export type OptionRow = {
  key: keyof Preferences
  label: string
  title: string
  checked: boolean
  /** Disabled beyond the form-wide busy flag (e.g. Eco has nothing to trim under Vanilla). */
  disabled?: boolean
  /** Dim the row when it is inapplicable rather than merely busy. */
  dim?: boolean
}

// One Global-option checkbox: a labelled toggle that writes straight through to the shared
// preferences. The Start form drives a table of these rather than hand-writing each row.
export function OptionToggle({ option, busy }: { option: OptionRow; busy: boolean }) {
  return (
    <label className={cn('flex items-center gap-1.5', option.dim ? 'opacity-40' : 'cursor-pointer')} title={option.title}>
      <input
        type="checkbox"
        checked={option.checked}
        onChange={e => updatePreferences({ [option.key]: e.target.checked } as Partial<Preferences>)}
        disabled={busy || option.disabled}
      />{' '}
      {option.label}
    </label>
  )
}
