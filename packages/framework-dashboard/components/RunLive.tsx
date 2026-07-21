import { useCallback, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { runProgress } from '@gemstack/framework/client'
import { RunActionBar } from './RunActionBar.js'
import { RunChat } from './RunChat.js'
import { RunFeed } from './RunFeed.js'
import { ChangesSummary, RunChanges } from './RunChanges.js'

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
  removeContext,
  lost = false,
  onRunStarted,
}: {
  projectId: string
  /** Which run to steer (#749); absent right after Start, before the poll adopts its id. */
  runId?: string | null | undefined
  events: FrameworkEvent[]
  files: string[]
  addContext: (path: string) => void
  removeContext?: ((path: string) => void) | undefined
  /** The live channel's health (#948) — surfaced as a banner over the feed. */
  lost?: boolean
  /** Jump to the run a new-session preset started from the chat below (#959). */
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
}) {
  // The session's own name, once the agent has set it (#874): presets in the chat below default
  // to targeting this session rather than the whole codebase.
  const sessionName = runProgress(events).sessionName
  // What it has changed so far (#817), counted in the branch row and listed only when asked
  // (#1023) — a live session's output is the thing being watched, and the file list used to sit
  // between it and the bar.
  const [changes, setChanges] = useState({ count: 0, added: 0, removed: 0 })
  const [openChanges, setOpenChanges] = useState(false)
  const onSummary = useCallback((count: number, added: number, removed: number) => {
    setChanges(prev => (prev.count === count && prev.added === added && prev.removed === removed ? prev : { count, added, removed }))
  }, [])
  return (
    <>
      <RunActionBar
        projectId={projectId}
        runId={runId}
        events={events}
        summary={<ChangesSummary {...changes} />}
        expanded={openChanges}
        {...(changes.count > 0 ? { onToggle: () => setOpenChanges(open => !open) } : {})}
      />
      {/* Only once the run's id is known: without one the read falls back to the project root and
          would report the user's own dirty files as the run's. */}
      {runId && <RunChanges projectId={projectId} runId={runId} open={openChanges} onSummary={onSummary} />}
      <RunFeed events={events} showSessionLink={false} lost={lost} />
      <RunChat projectId={projectId} runId={runId} files={files} addContext={addContext} removeContext={removeContext} sessionName={sessionName} onRunStarted={onRunStarted} />
    </>
  )
}
