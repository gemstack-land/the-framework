import { useEffect, useState } from 'react'
import type { RunMeta, RunStatus } from '@gemstack/framework'
import { Button } from './ui/button.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'
import { formatDateTime } from '../lib/format-date.js'

const STATUS_TONE: Record<string, string> = {
  running: 'text-primary',
  done: 'text-emerald-500',
  stopped: 'text-amber-500',
  failed: 'text-red-500',
}

// The Runs rail (#314 second sidebar). "Live" is the permanent home/launcher — selecting it
// shows the Start form + cards (ProjectHome), and it is never consumed by a run. Every run
// (live + archived, from `onRuns`) is its own row below it; selecting a run shows that run's
// own view (its live output while running, a replay once finished). `runs` is owned by the
// shell so the rail and the main pane share one list. `startTick`/`startIntent` seed an
// optimistic "starting…" row the instant Start is clicked, until the real run.json lands.
export function RunHistory({
  projectId,
  runs,
  selectedRunId,
  onSelect,
  startTick = 0,
  startIntent = '',
  followLive = false,
  collapsed = false,
}: {
  projectId: string | null
  runs: RunMeta[]
  selectedRunId: string | null
  onSelect: (runId: string | null) => void
  startTick?: number
  startIntent?: string
  /** Just started a run that reported no id, so there is nothing selected to highlight yet (#705):
   *  put the highlight on the running/optimistic row rather than the Live home row until the
   *  shell adopts the run's real id. A run that did report one is selected by URL instead (#784). */
  followLive?: boolean
  /** Give the room to a big view (#862): narrow to a strip, expanded again on hover or focus. */
  collapsed?: boolean
}) {
  const [optimistic, setOptimistic] = useState<string | null>(null)

  useEffect(() => {
    if (startTick > 0) setOptimistic(startIntent)
  }, [startTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRunning = runs.some(run => run.status === 'running')
  const newestRunningId = runs.find(run => run.status === 'running')?.id
  useEffect(() => {
    if (hasRunning) setOptimistic(null)
  }, [hasRunning])
  useEffect(() => {
    setOptimistic(null)
  }, [projectId])

  if (!projectId) return null

  // While following a just-started run, the highlight belongs on that run (its optimistic row,
  // then its real row) — not the Live home row, even though no run id is selected yet (#705).
  const atHome = selectedRunId === null && !followLive
  // A session selected but not in the list is one just started, whose row lands with its run.json
  // a beat later (#784): the optimistic row is standing in for it, so highlight that.
  const starting = followLive || (selectedRunId !== null && !runs.some(run => run.id === selectedRunId))

  // Collapsed, the strip is too narrow for words, and clipped half-words read as broken rather
  // than as deliberate. Fade the labels out and leave the status dots, which is all that fits;
  // opening the rail brings them back. Fading rather than unmounting keeps one DOM, so the
  // reveal is CSS and the rows stay tab-reachable while narrow.
  const label = collapsed
    ? 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100'
    : ''

  return (
    // Collapsed (#862), the rail reserves only a strip and its panel floats over the main pane
    // when opened, so hovering it does not reflow what you are reading. Focus-within opens it
    // too: hover is a mouse affordance, and the rows are still tab-reachable while narrow.
    <aside
      className={cn(
        'group relative shrink-0 transition-[width] duration-150',
        collapsed ? 'w-12' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-full flex-col overflow-hidden border-r border-border bg-background transition-[width] duration-150',
          collapsed
            ? 'absolute inset-y-0 left-0 z-20 w-12 group-hover:w-60 group-hover:shadow-lg group-focus-within:w-60 group-focus-within:shadow-lg'
            : 'w-full',
        )}
      >
      <div className={cn('whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground', label)}>
        Sessions
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {/* Permanent home / launcher — always present, never a run. */}
        <Button
          variant="ghost"
          className={cn('mb-1 w-full justify-start', collapsed && 'justify-center px-0', atHome && 'bg-accent text-accent-foreground')}
          onClick={() => onSelect(null)}
          title={collapsed ? 'Live' : undefined}
        >
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full bg-primary', !collapsed && 'mr-2')} />
          <span className={cn('whitespace-nowrap', label)}>Live</span>
        </Button>

        {/* A just-started run, before its run.json exists — highlighted while following it. */}
        {optimistic !== null && !hasRunning && (
          <RunRow status="running" intent={optimistic} subtitle="starting…" active={starting} dim collapsed={collapsed} onClick={() => onSelect(null)} />
        )}

        {runs.length === 0 && optimistic === null && (
          <p className={cn('whitespace-nowrap px-2 py-1 text-sm text-muted-foreground', label)}>No sessions yet.</p>
        )}
        {runs.map(run => (
          <RunRow
            key={run.id}
            status={run.status}
            intent={run.intent}
            subtitle={formatDateTime(run.startedAt)}
            // Following live highlights the newest running run, not every one of them (#738):
            // `runs` is newest-first, so that is the first with a running status.
            active={run.id === selectedRunId || (followLive && run.id === newestRunningId)}
            waiting={run.settledAt !== undefined}
            collapsed={collapsed}
            onClick={() => onSelect(run.id)}
          />
        ))}
      </div>
      </div>
    </aside>
  )
}

// One run row: a pulsing dot + RUNNING badge for a working run, a still dot + WAITING for one
// parked on the user (#785), else the terminal-status badge.
function RunRow({
  status,
  intent,
  subtitle,
  active,
  onClick,
  dim = false,
  waiting = false,
  collapsed = false,
}: {
  status: RunStatus
  intent: string | undefined
  subtitle: string
  active: boolean
  onClick: () => void
  dim?: boolean
  /** Live, but parked on the user rather than working (#785). */
  waiting?: boolean
  /** In the narrow strip (#862): labels fade out, so the row is carried by its dot alone. */
  collapsed?: boolean
}) {
  // Only a live run can be waiting on you; a finished one is just finished.
  const parked = waiting && status === 'running'
  const label = collapsed
    ? 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100'
    : ''
  return (
    <Button
      variant="ghost"
      className={cn(
        'mb-0.5 h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left',
        collapsed && 'px-0',
        active && 'bg-accent text-accent-foreground',
        dim && 'opacity-70',
      )}
      onClick={onClick}
    >
      <span className="flex w-full items-center gap-2">
        {/* The dot means "the agent is working", so a run parked on you gets a still one (#785):
            it used to pulse identically whether it was mid-edit or had been idle for an hour. */}
        {status === 'running' && (
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', parked ? 'bg-muted-foreground' : 'animate-pulse bg-primary')} />
        )}
        {/* Collapsed, a finished run has no dot of its own and its badge has faded, so the row
            would be an empty line. Give it one in the status' colour: the strip is a list of
            sessions by state, which is as much as fits. */}
        {collapsed && status !== 'running' && (
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full bg-current', STATUS_TONE[status])} />
        )}
        <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', parked ? 'text-muted-foreground' : STATUS_TONE[status], label)}>
          {parked ? 'waiting' : status}
        </Badge>
        <span className={cn('truncate text-xs font-normal text-muted-foreground', label)}>{subtitle}</span>
      </span>
      <span className={cn('w-full truncate text-sm font-medium', label)}>{intent || '(no prompt)'}</span>
    </Button>
  )
}
