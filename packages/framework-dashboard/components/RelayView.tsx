import { EventStream } from './EventStream.js'
import { Badge } from './ui/badge.js'
import { useLiveEvents } from '../lib/use-live-events.js'

// The shared-run watch view (#426/#230): when the dashboard is opened on the relay at
// `/?run=<id>`, it shows one run read-only, streamed from the relay's in-memory event
// feed over the same Telefunc `onEvents` Channel the daemon uses. No Projects/Runs/Docs
// rails and no steering — a teammate with the link watches, they do not drive.
export function RelayView({ runId }: { runId: string }) {
  const events = useLiveEvents(runId)
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="font-semibold">The Framework</span>
        <Badge className="text-muted-foreground">watching</Badge>
        <span className="ml-auto text-xs text-muted-foreground">read-only shared run</span>
      </header>
      <main className="flex min-w-0 flex-1 flex-col">
        <EventStream projectId={runId} events={events} readOnly />
      </main>
    </div>
  )
}
