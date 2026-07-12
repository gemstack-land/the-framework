import { useEffect, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import type { ClientChannel } from 'telefunc'
import { onEvents } from '../server/events.telefunc.js'
import { sendStop } from '../server/control.telefunc.js'
import { pendingChoice, isRunActive } from '../lib/live-state.js'
import { EventList } from './EventList.js'
import { ChoicePanel } from './ChoicePanel.js'
import { Button } from './ui/button.js'

// The live event stream (#405/#314): a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over a Telefunc Channel
// (server/events.telefunc.ts) that pushes one `FrameworkEvent` per new line. The same
// projection drives the write side (#405): the interactive gate the run parks on and
// a Stop button, both posted back over Telefunc (server/control.telefunc.ts).
export function EventStream({ projectId }: { projectId: string | null }) {
  const [events, setEvents] = useState<FrameworkEvent[]>([])

  useEffect(() => {
    setEvents([])
    if (!projectId) return
    let channel: ClientChannel<never, FrameworkEvent> | undefined
    let cancelled = false
    void onEvents(projectId).then(ch => {
      if (cancelled) {
        void ch.close()
        return
      }
      channel = ch
      ch.listen(event => setEvents(prev => [...prev, event]))
    })
    return () => {
      cancelled = true
      void channel?.close()
    }
  }, [projectId])

  if (!projectId) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Select a project to watch its live run.</div>
  }
  if (events.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
        Waiting for events… (start a run in this project)
      </div>
    )
  }

  const choice = pendingChoice(events)
  return (
    <>
      {isRunActive(events) && (
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <Button variant="outline" size="sm" onClick={() => void sendStop(projectId)}>
            Stop run
          </Button>
        </div>
      )}
      {choice && <ChoicePanel key={choice.id} projectId={projectId} choice={choice} />}
      <EventList events={events} />
    </>
  )
}
