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

// The run's agent + model as one tree (#650/#656/#658): the top level is the coding agents, and
// each agent's submenu holds only its own models. Picking a model sets both the agent and the
// model together, so an incompatible pair (e.g. Codex + a Claude model) can't be chosen. The
// trigger shows the current agent's logo then the model.

export interface ModelOption {
  value: string
  label: string
}

export interface AgentOption {
  value: string
  label: string
  /** The agent's logo, shown on the trigger and beside its name (#656). */
  icon?: ReactNode
  /** The models this agent offers; the first is its default. */
  models: ModelOption[]
}

function agentOf(agents: AgentOption[], value: string): AgentOption | undefined {
  return agents.find(a => a.value === value) ?? agents[0]
}

/** The label for the current model within an agent's own list, falling back to its default. */
function modelLabel(agent: AgentOption | undefined, model: string): string {
  if (!agent) return ''
  return (agent.models.find(m => m.value === model) ?? agent.models[0])?.label ?? ''
}

export function AgentModelMenu({
  agents,
  agent,
  model,
  onChange,
  busy,
}: {
  agents: AgentOption[]
  agent: string
  model: string
  /** Set the agent and model together (a model is always picked within its agent). */
  onChange: (agent: string, model: string) => void
  busy: boolean
}) {
  const current = agentOf(agents, agent)
  const currentModelLabel = modelLabel(current, model)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        title={`Agent: ${current?.label ?? ''} · Model: ${currentModelLabel}`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1.5 px-2 font-normal')}
      >
        {current?.icon ? (
          <span className="flex h-4 w-4 items-center justify-center">{current.icon}</span>
        ) : (
          current?.label
        )}
        {currentModelLabel}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {agents.map(a => (
          <DropdownMenuSub key={a.value}>
            <DropdownMenuSubTrigger>
              <Check className={cn('h-3.5 w-3.5 shrink-0', a.value === agent ? 'opacity-100' : 'opacity-0')} />
              {a.icon && <span className="flex h-4 w-4 items-center justify-center">{a.icon}</span>}
              <span className="flex-1">{a.label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {a.models.map(m => (
                <DropdownMenuItem key={m.value} onClick={() => onChange(a.value, m.value)}>
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      a.value === agent && m.value === model ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
