import type { FrameworkEvent } from '@gemstack/framework'
import { RunActionBar } from './RunActionBar.js'
import { RunFeed } from './RunFeed.js'

// One running run's own view (its output): the action bar (Serve · Stop · Open session) plus the
// run overview + live event feed from the shared Telefunc Channel. Distinct from the home launcher
// (ProjectHome) and a finished run's replay (RunReplay). Single-run today streams the project's
// one live feed; per-run streams arrive with worktrees (#453). The session link lives in the
// action bar now, so the feed's overview drops it (`showSessionLink={false}`).
export function RunLive({ projectId, events }: { projectId: string; events: FrameworkEvent[] }) {
  return (
    <>
      <RunActionBar projectId={projectId} events={events} />
      <RunFeed events={events} showSessionLink={false} />
    </>
  )
}
