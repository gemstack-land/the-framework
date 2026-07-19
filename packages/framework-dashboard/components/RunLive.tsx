import type { FrameworkEvent } from '@gemstack/framework'
import { RunActionBar } from './RunActionBar.js'
import { RunChat } from './RunChat.js'
import { RunFeed } from './RunFeed.js'

// One running run's own view (its output): the action bar (Serve · Stop · Open session), the run
// overview + live event feed from the shared Telefunc Channel, and the chat composer to send it
// more messages (#714). Distinct from the home launcher (ProjectHome) and a finished run's replay
// (RunReplay, which has no composer). The feed and every steering call are addressed by run id
// (#749), so this is one run's view even when the project has others live. The session link lives in the action bar now, so the feed's
// overview drops it (`showSessionLink={false}`). `files`/`addContext` flow through to RunChat's
// shared Composer for the `#`/`@` pickers (#721).
export function RunLive({
  projectId,
  runId,
  events,
  files,
  addContext,
}: {
  projectId: string
  /** Which run to steer (#749); absent right after Start, before the poll adopts its id. */
  runId?: string | null | undefined
  events: FrameworkEvent[]
  files: string[]
  addContext: (path: string) => void
}) {
  return (
    <>
      <RunActionBar projectId={projectId} runId={runId} events={events} />
      <RunFeed events={events} showSessionLink={false} />
      <RunChat projectId={projectId} runId={runId} files={files} addContext={addContext} />
    </>
  )
}
