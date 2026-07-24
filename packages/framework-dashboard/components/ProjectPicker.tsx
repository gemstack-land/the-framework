import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '@gemstack/the-framework'
import { ChevronDown, Check, LayoutDashboard, Plus } from 'lucide-react'
import { onProjects } from '../server/projects.telefunc.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

// The project picker (#772): one dropdown in the top nav, replacing the left-most rail that
// listed every project. It is always shown, including on the Overview, so the current project
// is readable from any page instead of only from a rail that scrolled.
//
// Single-select, per #772's MVP ("A simple dropdown to select *one* project"). Multi-project
// selection and topics are post-MVP and want a different control, so nothing here assumes one
// project either way: the value is the route's `selectedId`, and picking one just navigates.
//
// The Overview entry keeps the "needs you" badge (#632) that lived on the rail's nav button,
// and `Add project` keeps its own trust gate (#439) in the panel it opens.
export function ProjectPicker({
  selectedId,
  onSelect,
  onDashboard,
  interventionCount = 0,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
  onDashboard: () => void
  /** Count for the "needs you" badge on the Overview entry (#632). 0 hides it. */
  interventionCount?: number
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(() => {
    void onProjects().then(setProjects)
  }, [])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A selection naming no registered project is not corrected here: the URL is the selection
  // (#784), so silently rewriting it would read as "the link worked, you clicked the wrong one".
  // The shell says so instead; this control only reports what it was given.
  const selected = selectedId === null ? null : projects?.find(p => p.id === selectedId)
  // One name for the no-project state (#948): the trigger used to say "All projects" while the
  // menu entry it maps to says "Overview" — two names for one place. While the list is still
  // loading, an ellipsis stands in rather than flashing the raw project id.
  const label = selectedId === null ? 'Overview' : (selected?.name ?? (projects === null ? '…' : selectedId))

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          // Names the control and its value: the visible text alone is just a project name,
          // which does not say it is a picker.
          aria-label={`Project: ${label}`}
          title="Select a project"
          // Capped narrower below sm so a long project name cannot push the nav past a narrow
          // viewport (#980); the label truncates. Full width returns at sm.
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-w-40 gap-1.5 font-normal sm:max-w-56')}
        >
          <span className="truncate">{label}</span>
          {interventionCount > 0 && selectedId !== null && (
            // The badge lives on the Overview entry, which is out of sight while the menu is
            // closed. Keep the count visible on the trigger too, or removing the rail would
            // have hidden the one signal that something needs a human (#632).
            <span className="min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold text-primary-foreground tabular-nums">
              {interventionCount}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onDashboard}>
            <Check className={cn('h-3.5 w-3.5 shrink-0', selectedId === null ? 'opacity-100' : 'opacity-0')} />
            <LayoutDashboard className="h-4 w-4" />
            <span className="flex-1">Overview</span>
            {interventionCount > 0 && (
              <span
                className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                title={`${interventionCount} item${interventionCount === 1 ? '' : 's'} need${interventionCount === 1 ? 's' : ''} you`}
              >
                {interventionCount}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {projects === null && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
          {projects?.length === 0 && <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>}
          {projects?.map(p => (
            <DropdownMenuItem key={p.id} onClick={() => onSelect(p.id)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', p.id === selectedId ? 'opacity-100' : 'opacity-0')} />
              {/* Status by color alone reads as nothing to a screen reader (#695/U33): hide the
                  decorative dot and give it an sr-only text alternative. */}
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 rounded-full', p.activated ? 'bg-primary' : 'bg-muted-foreground')}
                title={p.activated ? 'activated' : 'not activated'}
              />
              <span className="sr-only">{p.activated ? 'Activated' : 'Not activated'}: </span>
              <span className="flex-1 truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 shrink-0" />
            Add project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {adding && <AddProjectPanel onAdded={reload} onClose={() => setAdding(false)} />}
    </>
  )
}
