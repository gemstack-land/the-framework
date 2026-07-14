import { useCallback, useEffect, useState } from 'react'
import type { RunMeta } from '@gemstack/framework'
import { onRuns } from '../server/reads.telefunc.js'
import { Button } from './ui/button.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'

const STATUS_TONE: Record<string, string> = {
  running: 'text-primary',
  done: 'text-emerald-500',
  stopped: 'text-amber-500',
  failed: 'text-red-500',
}

// The Runs rail (#314 second sidebar): the selected project's runs over a Telefunc RPC
// (server/reads.telefunc.ts). The live run is prepended by the server with a `running`
// status, so it shows here the moment it starts; picking it follows the live stream
// (selectedRunId === null), picking a finished run replays it. `startTick`/`startIntent`
// come from the Start form: on a new start we show an optimistic `running` row with the
// typed prompt right away, until the server's real running meta lands on the next poll.
export function RunHistory({
  projectId,
  selectedRunId,
  onSelect,
  startTick = 0,
  startIntent = '',
}: {
  projectId: string | null
  selectedRunId: string | null
  onSelect: (runId: string | null) => void
  startTick?: number
  startIntent?: string
}) {
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [optimistic, setOptimistic] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!projectId) return Promise.resolve()
    return onRuns(projectId).then(list => setRuns(list))
  }, [projectId])

  useEffect(() => {
    setOptimistic(null)
    if (!projectId) {
      setRuns([])
      return
    }
    let live = true
    const tick = () => void load().then(() => live || undefined)
    tick()
    const poll = setInterval(tick, 2000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [projectId, load])

  // A fresh start: seed the optimistic row with the typed prompt and refetch now so the
  // real running meta replaces it as soon as the spawned process writes its run.json.
  useEffect(() => {
    if (startTick === 0) return
    setOptimistic(startIntent)
    void load()
  }, [startTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Once the server reports the run as running, the optimistic placeholder is redundant.
  const realRunning = runs.find(run => run.status === 'running')
  useEffect(() => {
    if (realRunning) setOptimistic(null)
  }, [realRunning])

  if (!projectId) return null

  const history = runs.filter(run => run.status !== 'running')
  const liveActive = selectedRunId === null

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runs</div>
      <div className="flex-1 overflow-y-auto px-2">
        {realRunning ? (
          <LiveEntry
            active={liveActive}
            intent={realRunning.intent}
            subtitle={new Date(realRunning.startedAt).toLocaleString()}
            onClick={() => onSelect(null)}
          />
        ) : optimistic !== null ? (
          <LiveEntry active={liveActive} intent={optimistic} subtitle="starting…" onClick={() => onSelect(null)} />
        ) : (
          <Button
            variant="ghost"
            className={cn('mb-1 w-full justify-start', liveActive && 'bg-accent text-accent-foreground')}
            onClick={() => onSelect(null)}
          >
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-muted-foreground" /> Live
          </Button>
        )}

        {history.length === 0 && optimistic === null && !realRunning && (
          <p className="px-2 py-1 text-sm text-muted-foreground">No runs yet.</p>
        )}
        {history.map(run => (
          <Button
            key={run.id}
            variant="ghost"
            className={cn(
              'mb-0.5 h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left',
              run.id === selectedRunId && 'bg-accent text-accent-foreground',
            )}
            onClick={() => onSelect(run.id)}
          >
            <span className="flex w-full items-center gap-2">
              <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', STATUS_TONE[run.status])}>
                {run.status}
              </Badge>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {new Date(run.startedAt).toLocaleString()}
              </span>
            </span>
            <span className="w-full truncate text-sm font-medium">{run.intent || '(no prompt)'}</span>
          </Button>
        ))}
      </div>
    </aside>
  )
}

// The live/running run rendered as a list row (not the bare "Live" button): a pulsing dot +
// RUNNING badge + the prompt, so a just-started run reads the same as its history siblings.
function LiveEntry({
  active,
  intent,
  subtitle,
  onClick,
}: {
  active: boolean
  intent: string | undefined
  subtitle: string
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        'mb-0.5 h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left',
        active && 'bg-accent text-accent-foreground',
      )}
      onClick={onClick}
    >
      <span className="flex w-full items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', STATUS_TONE.running)}>running</Badge>
        <span className="truncate text-xs font-normal text-muted-foreground">{subtitle}</span>
      </span>
      <span className="w-full truncate text-sm font-medium">{intent || '(no prompt)'}</span>
    </Button>
  )
}
