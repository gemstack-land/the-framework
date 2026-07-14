import type { FrameworkEvent } from '@gemstack/framework'
import { StartRunForm } from './StartRunForm.js'
import { PreviewBar } from './PreviewBar.js'
import { RunOverview } from './RunOverview.js'

// The project home / launcher — what "Live" selects. Always the Start form + preset cards +
// the current stack overview; it is never consumed by a run. Starting one appends a run to
// the rail and adds that run's own view (RunLive) alongside — this page stays put, so you can
// launch again. (Actually running several at once lands with git worktrees, #453.)
export function ProjectHome({
  projectId,
  events,
  onRunStarted,
}: {
  projectId: string
  events: FrameworkEvent[]
  onRunStarted?: ((intent: string) => void) | undefined
}) {
  return (
    <>
      <PreviewBar projectId={projectId} />
      <StartRunForm projectId={projectId} onRunStarted={onRunStarted} />
      {events.length > 0 && <RunOverview events={events} />}
    </>
  )
}
