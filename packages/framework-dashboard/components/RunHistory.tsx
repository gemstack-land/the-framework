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
}: {
  projectId: string | null
  runs: RunMeta[]
  selectedRunId: string | null
  onSelect: (runId: string | null) => void
  startTick?: number
  startIntent?: string
  /** Just started a run and following its live output (#705): highlight the running/optimistic
   *  row at once, not the Live home row, before the poll adopts the run's real id. */
  followLive?: boolean
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

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sessions</div>
      <div className="flex-1 overflow-y-auto px-2">
        {/* Permanent home / launcher — always present, never a run. */}
        <Button
          variant="ghost"
          className={cn('mb-1 w-full justify-start', atHome && 'bg-accent text-accent-foreground')}
          onClick={() => onSelect(null)}
        >
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary" /> Live
        </Button>

        {/* A just-started run, before its run.json exists — highlighted while following it. */}
        {optimistic !== null && !hasRunning && (
          <RunRow status="running" intent={optimistic} subtitle="starting…" active={followLive} dim onClick={() => onSelect(null)} />
        )}

        {runs.length === 0 && optimistic === null && (
          <p className="px-2 py-1 text-sm text-muted-foreground">No sessions yet.</p>
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
            onClick={() => onSelect(run.id)}
          />
        ))}
      </div>
    </aside>
  )
}

// One run row: a pulsing dot + RUNNING badge for a live run, else the terminal-status badge.
function RunRow({
  status,
  intent,
  subtitle,
  active,
  onClick,
  dim = false,
}: {
  status: RunStatus
  intent: string | undefined
  subtitle: string
  active: boolean
  onClick: () => void
  dim?: boolean
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        'mb-0.5 h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left',
        active && 'bg-accent text-accent-foreground',
        dim && 'opacity-70',
      )}
      onClick={onClick}
    >
      <span className="flex w-full items-center gap-2">
        {status === 'running' && <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />}
        <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', STATUS_TONE[status])}>{status}</Badge>
        <span className="truncate text-xs font-normal text-muted-foreground">{subtitle}</span>
      </span>
      <span className="w-full truncate text-sm font-medium">{intent || '(no prompt)'}</span>
    </Button>
  )
}
