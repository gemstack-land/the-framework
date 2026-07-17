import { ChevronDown, Check } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'

// A single-select dropdown styled like the Presets menu (#650/#649): the agent and model pickers
// use it so all three controls under the textarea read as one set. The trigger shows the current
// option's label; each menu item sets the value and marks the active one with a check.

export interface PickerOption {
  value: string
  label: string
}

export function PickerMenu({
  value,
  options,
  onChange,
  busy,
  title,
}: {
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  busy: boolean
  /** Tooltip on the trigger, e.g. "Coding agent" / "Model". */
  title: string
}) {
  const current = options.find(o => o.value === value) ?? options[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        title={title}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5 font-normal')}
      >
        {current?.label}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map(o => (
          <DropdownMenuItem key={o.value} onClick={() => onChange(o.value)}>
            <Check className={cn('h-3.5 w-3.5', o.value === value ? 'opacity-100' : 'opacity-0')} />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
