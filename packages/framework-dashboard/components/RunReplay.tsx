import { useEffect, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { onRun } from '../server/reads.telefunc.js'
import { EventList } from './EventList.js'

// Replay one archived run: load its event log over a Telefunc RPC and render it in the
// same EventList the live stream uses (no auto-scroll — it is a static log).
export function RunReplay({ projectId, runId }: { projectId: string; runId: string }) {
  const [events, setEvents] = useState<FrameworkEvent[] | null>(null)

  useEffect(() => {
    let live = true
    setEvents(null)
    void onRun(projectId, runId).then(list => live && setEvents(list))
    return () => {
      live = false
    }
  }, [projectId, runId])

  if (events === null) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading run…</div>
  if (events.length === 0) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">This run has no events.</div>
  return <EventList events={events} stick={false} />
}
