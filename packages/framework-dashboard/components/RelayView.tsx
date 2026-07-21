import { RunFeed } from './RunFeed.js'
import { Badge } from './ui/badge.js'
import { useLiveEvents } from '../lib/use-live-events.js'
import { isRunActive } from '../lib/live-state.js'
import { useFavicon } from '../lib/favicon.js'
import { Logo } from './Logo.js'

// The shared-run watch view (#426/#230): when the dashboard is opened on the relay at
// `/?run=<id>`, it shows one run read-only, streamed from the relay's in-memory event
// feed over the same Telefunc `onEvents` Channel the daemon uses. No Projects/Runs/Docs
// rails and no steering — a teammate with the link watches, they do not drive.
export function RelayView({ runId }: { runId: string }) {
  // The run id rides in the projectId slot: the relay keys `onEvents` by it (no registry).
  const { events, lost } = useLiveEvents(runId)
  // The mark and the tab icon (#875) follow the one run being watched, since that is all the
  // relay knows about — it has no project registry to ask.
  const working = isRunActive(events)
  useFavicon(working)
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Logo className="h-5 w-auto shrink-0" working={working} />
        <span className="font-semibold">The Framework</span>
        <Badge className="text-muted-foreground">watching</Badge>
        <span className="ml-auto text-xs text-muted-foreground">read-only shared session</span>
      </header>
      <main className="flex min-w-0 flex-1 flex-col">
        <RunFeed events={events} lost={lost} />
      </main>
    </div>
  )
}
