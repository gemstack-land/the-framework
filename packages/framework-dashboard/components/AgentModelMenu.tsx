import type { ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './ui/dropdown-menu.js'

// One dropdown for both the coding agent (#650) and the model (#628), each in its own submenu,
// styled like the Presets menu so the run controls read as one set. The trigger shows the agent's
// logo (#656) then the model; a submenu item sets its value and the active one is checked.

export interface PickerOption {
  value: string
  label: string
  /** An optional leading glyph (e.g. the agent's logo, #656), shown beside the label. */
  icon?: ReactNode
}

function optionOf(options: PickerOption[], value: string): PickerOption | undefined {
  return options.find(o => o.value === value) ?? options[0]
}

function labelOf(options: PickerOption[], value: string): string {
  return optionOf(options, value)?.label ?? ''
}

/** A submenu of single-select options with a check on the active one. */
function OptionSubmenu({
  heading,
  options,
  value,
  onChange,
}: {
  heading: string
  options: PickerOption[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex-1">{heading}</span>
        <span className="text-[var(--color-muted-foreground)]">{labelOf(options, value)}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {options.map(o => (
          <DropdownMenuItem key={o.value} onClick={() => onChange(o.value)}>
            <Check className={cn('h-3.5 w-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
            {o.icon && <span className="flex h-4 w-4 items-center justify-center">{o.icon}</span>}
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function AgentModelMenu({
  agent,
  agentOptions,
  onAgentChange,
  model,
  modelOptions,
  onModelChange,
  busy,
}: {
  agent: string
  agentOptions: PickerOption[]
  onAgentChange: (value: string) => void
  model: string
  modelOptions: PickerOption[]
  onModelChange: (value: string) => void
  busy: boolean
}) {
  const currentAgent = optionOf(agentOptions, agent)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        title={`Agent: ${labelOf(agentOptions, agent)} · Model: ${labelOf(modelOptions, model)}`}
        className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1.5 font-normal')}
      >
        {/* The agent's logo stands in for its name (#656); fall back to the label if it has none. */}
        {currentAgent?.icon ? (
          <span className="flex h-4 w-4 items-center justify-center">{currentAgent.icon}</span>
        ) : (
          labelOf(agentOptions, agent)
        )}
        <span className="text-[var(--color-muted-foreground)]">·</span>
        {labelOf(modelOptions, model)}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <OptionSubmenu heading="Agent" options={agentOptions} value={agent} onChange={onAgentChange} />
        <OptionSubmenu heading="Model" options={modelOptions} value={model} onChange={onModelChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
