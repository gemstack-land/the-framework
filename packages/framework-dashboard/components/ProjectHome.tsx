import type { FrameworkEvent } from '@gemstack/framework'
import { StartRunForm } from './StartRunForm.js'
import { ProjectActions } from './ProjectActions.js'
import { RunOverview } from './RunOverview.js'

// The project home / launcher — what "Live" selects. Always the Start form + preset cards +
// the current stack overview; it is never consumed by a run. Starting one appends a run to
// the rail and adds that run's own view (RunView) alongside — this page stays put, so you can
// launch again. (Actually running several at once lands with git worktrees, #453.)
export function ProjectHome({
  projectId,
  events,
  onRunStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
}: {
  projectId: string
  events: FrameworkEvent[]
  onRunStarted?: ((intent: string) => void) | undefined
  files: string[]
  context: Set<string>
  addContext: (path: string) => void
  removeContext: (path: string) => void
  toggleContext: (path: string) => void
}) {
  return (
    <>
      <ProjectActions projectId={projectId} />
      <StartRunForm
        projectId={projectId}
        onRunStarted={onRunStarted}
        files={files}
        context={context}
        addContext={addContext}
        removeContext={removeContext}
        toggleContext={toggleContext}
      />
      {events.length > 0 && <RunOverview events={events} />}
    </>
  )
}
