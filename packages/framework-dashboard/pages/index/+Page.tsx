import { useState } from 'react'
import type { Intervention } from '@gemstack/framework'
import { onProjectFiles, onInterventions } from '../../server/reads.telefunc.js'
import { ProjectsSidebar } from '../../components/ProjectsSidebar.js'
import { NotificationBell } from '../../components/NotificationBell.js'
import { DiscordToggle } from '../../components/DiscordToggle.js'
import { RunHistory } from '../../components/RunHistory.js'
import { ProjectHome } from '../../components/ProjectHome.js'
import { DashboardPage } from '../../components/DashboardPage.js'
import { RunLive } from '../../components/RunLive.js'
import { RunReplay } from '../../components/RunReplay.js'
import { RightRail } from '../../components/RightRail.js'
import { RelayView } from '../../components/RelayView.js'
import { Badge } from '../../components/ui/badge.js'
import { useLiveEvents } from '../../lib/use-live-events.js'
import { useRuns } from '../../lib/use-runs.js'
import { useLoaded, usePolled } from '../../lib/use-async.js'
import { usePersistentState } from '../../lib/use-persistent-state.js'
import { useContextSet } from '../../lib/use-context-set.js'
import { useInterventionNotifications } from '../../lib/use-intervention-notifications.js'
import { usePreferences, notificationsEnabled } from '../../lib/preferences.js'
import { pendingChoices, agentViews } from '../../lib/live-state.js'

/** Stable, so `files` keeps one identity while no project is selected. */
const EMPTY_FILES: string[] = []

/** Stable initial for the interventions poll, so it does not churn on every render. */
const EMPTY_INTERVENTIONS: Intervention[] = []

// The dashboard shell (#405 phase 2): Projects | Runs | main | Docs/Log rail. The main pane
// is one of three views chosen by the Runs-rail selection: the project home/launcher (Live,
// the default — Start form + cards), a running run's own live output (RunLive), or a finished
// run's replay (RunReplay). Everything over the wire is Telefunc. A projection of the same
// .the-framework files the daemon writes.
// Remember the selected project across reloads so a refresh returns you to the same one
// (#475): otherwise the dashboard resets to auto-selecting the first project, and anything
// keyed to the selection — a running Preview, the live stream — looks empty for the project
// you were actually on.
const SELECTED_PROJECT_KEY = 'the-framework.selectedProjectId'

export default function Page() {
  const [projectId, setProjectId] = usePersistentState(SELECTED_PROJECT_KEY)
  // null = the project home/launcher (Live); a run id = that run's view.
  const [runId, setRunId] = useState<string | null>(null)
  // A just-started run: bump the tick so the Runs rail shows an optimistic "starting…" row
  // with the typed prompt at once, before the spawned process writes its run.json.
  const [runStart, setRunStart] = useState<{ tick: number; intent: string }>({ tick: 0, intent: '' })

  const { runs, reload } = useRuns(projectId)

  // The run Context set lives in the shell (#492/#504) so the two surfaces that feed it share
  // one source of truth: the `#` file chips + whole-repo Context selector in the Start form
  // (main pane), and the file tree in the right rail.
  const { context, add: addContext, toggle: toggleContext, reset: resetContext } = useContextSet()

  // The selected project's files (git ls-files), fetched once here and handed to both the
  // `#` picker and the tree. Empty when no project / on the relay (no checkout).
  const files = useLoaded<string[]>(projectId ? () => onProjectFiles(projectId) : null, EMPTY_FILES, [projectId])

  // The cross-project "needs you" queue (#632): open PRs to review. Polled here in the shell so
  // the sidebar badge and the Overview card share one poll. Slow cadence — PRs change rarely and
  // each poll spawns `gh` per project.
  const { value: interventions } = usePolled<Intervention[]>(onInterventions, EMPTY_INTERVENTIONS, 15000, [])

  // Fire a browser notification when a new item lands on the "needs you" queue (#627). Rides the
  // one interventions poll above; the browser permission is the real gate (see the header bell).
  const preferences = usePreferences()
  useInterventionNotifications(interventions, notificationsEnabled(preferences))

  const onRunStarted = (intent: string) => {
    // Stay on the home launcher (it must stay visible so you can launch again); the new run
    // just appends to the rail. Reload so its real row replaces the optimistic one quickly.
    setRunStart(prev => ({ tick: prev.tick + 1, intent }))
    reload()
  }

  const selectProject = (id: string) => {
    setProjectId(id) // persisted, so a refresh returns here
    setRunId(null) // switching projects always returns to the home launcher
    resetContext() // the picked context is the old project's — start fresh
  }

  // The Overview dashboard (#471): no project selected. Clearing projectId forgets the
  // remembered project too, so a refresh lands back on the dashboard, not the last project.
  const showDashboard = () => {
    setProjectId(null)
    setRunId(null)
  }

  // The live run feed is owned here so both the main view and the right rail's choice gates
  // (#440) read one shared Telefunc Channel. Hooks run before the relay early return below.
  const events = useLiveEvents(projectId)
  const choices = projectId ? pendingChoices(events) : []
  const views = projectId ? agentViews(events) : []

  // On the relay (#426), the URL carries `?run=<id>` and there is no local registry or
  // files — show that one run read-only. `window` is absent during prerender (ssr:false),
  // so this resolves to the full shell at build time and only flips in the browser. Hooks
  // above run unconditionally (rules of hooks); this early return is safe after them.
  const relayRun = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('run')
  if (relayRun) return <RelayView runId={relayRun} />

  // Route the main pane: the Overview dashboard when no project is selected (#471); else the
  // project home/launcher, a running run's live output, or a finished run's replay. (One
  // project streams one live feed today; per-run streams land with worktrees, #453.)
  const selectedRun = runId ? runs.find(run => run.id === runId) : undefined
  const renderMain = () => {
    if (!projectId) return <DashboardPage onSelectProject={selectProject} interventions={interventions} />
    if (runId === null)
      return (
        <ProjectHome
          projectId={projectId}
          events={events}
          onRunStarted={onRunStarted}
          files={files}
          context={context}
          addContext={addContext}
          toggleContext={toggleContext}
        />
      )
    if (selectedRun?.status === 'running') return <RunLive projectId={projectId} events={events} />
    return <RunReplay projectId={projectId} runId={runId} />
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="font-semibold">The Framework</span>
        <Badge className="text-muted-foreground">dashboard</Badge>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <DiscordToggle />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <ProjectsSidebar
          selectedId={projectId}
          onSelect={selectProject}
          onDashboard={showDashboard}
          interventionCount={interventions.length}
        />
        <RunHistory
          projectId={projectId}
          runs={runs}
          selectedRunId={runId}
          onSelect={setRunId}
          startTick={runStart.tick}
          startIntent={runStart.intent}
        />
        <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
        <RightRail
          projectId={projectId}
          choices={choices}
          views={views}
          files={files}
          context={context}
          toggleContext={toggleContext}
        />
      </div>
    </div>
  )
}
