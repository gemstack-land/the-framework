import type { FrameworkEvent } from '@gemstack/framework'
import { sendStop } from '../server/control.telefunc.js'
import { EventList } from './EventList.js'
import { PreviewBar } from './PreviewBar.js'
import { RunOverview } from './RunOverview.js'
import { Button } from './ui/button.js'

// One running run's own view (its output): the run overview + the live event feed from the
// shared Telefunc Channel, plus a Stop control. Distinct from the home launcher (ProjectHome)
// and a finished run's replay (RunReplay). Single-run today streams the project's one live
// feed; per-run streams arrive with worktrees (#453).
export function RunLive({ projectId, events }: { projectId: string; events: FrameworkEvent[] }) {
  return (
    <>
      <PreviewBar projectId={projectId} />
      <div className="flex items-center justify-end border-b border-border px-4 py-2">
        <Button variant="outline" size="sm" onClick={() => void sendStop(projectId)}>
          Stop run
        </Button>
      </div>
      {events.length > 0 ? (
        <>
          <RunOverview events={events} />
          <EventList events={events} />
        </>
      ) : (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Waiting for the run to start…</div>
      )}
    </>
  )
}
