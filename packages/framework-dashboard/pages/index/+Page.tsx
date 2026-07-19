import { useEffect, useState } from 'react'
import type { Intervention, Activity, ProjectSummary } from '@gemstack/framework'
import { onProjectFiles, onInterventions, onActivity } from '../../server/reads.telefunc.js'
import { onProjects } from '../../server/projects.telefunc.js'
import { ProjectsSidebar } from '../../components/ProjectsSidebar.js'
import { Logo } from '../../components/Logo.js'
import { ThemeToggle } from '../../components/ThemeToggle.js'
import { NotificationsMenu } from '../../components/NotificationsMenu.js'
import { RunHistory } from '../../components/RunHistory.js'
import { ProjectHome } from '../../components/ProjectHome.js'
import { DashboardPage } from '../../components/DashboardPage.js'
import { RunLive } from '../../components/RunLive.js'
import { RunReplay } from '../../components/RunReplay.js'
import { RightRail } from '../../components/RightRail.js'
import { RelayView } from '../../components/RelayView.js'
import { useLiveEvents } from '../../lib/use-live-events.js'
import { useRuns } from '../../lib/use-runs.js'
import { useLoaded, usePolled } from '../../lib/use-async.js'
import { usePersistentState } from '../../lib/use-persistent-state.js'
import { useContextSet } from '../../lib/use-context-set.js'
import { useInterventionNotifications } from '../../lib/use-intervention-notifications.js'
import { useActivityNotifications } from '../../lib/use-activity-notifications.js'
import { usePreferences, notificationsEnabled, newActivityEnabled, humanInterventionEnabled } from '../../lib/preferences.js'
import { pendingChoices, agentViews } from '../../lib/live-state.js'
import { useDocumentTitle } from '../../lib/document-title.js'

/** Stable, so `files` keeps one identity while no project is selected. */
const EMPTY_FILES: string[] = []

/** Stable initial for the projects load, so it does not churn on every render. */
const EMPTY_PROJECTS: ProjectSummary[] = []

/** Stable initial for the interventions poll, so it does not churn on every render. */
const EMPTY_INTERVENTIONS: Intervention[] = []

/** Stable initial for the activity poll (#627), so it does not churn on every render. */
const EMPTY_ACTIVITY: Activity[] = []

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
  // Just pressed Start: jump straight to the run's live output. sendStart returns no id (the
  // run is a detached process that writes its run.json a beat later), so follow the shared live
  // feed until the poll surfaces the real run row, which the effect below adopts as the selection.
  const [followLive, setFollowLive] = useState(false)
  // The id the daemon gave the run we just started (#761), so the poll selects that exact run.
  const [startedRunId, setStartedRunId] = useState<string | null>(null)

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

  // The registered projects, loaded once for the browser-tab title (#695/U3): the selected
  // project's name plus the needs-you count drive `document.title` so a backgrounded tab tells
  // you which project needs attention. The sidebar keeps its own poll; this is a cheap one-shot.
  const projects = useLoaded<ProjectSummary[]>(onProjects, EMPTY_PROJECTS, [])
  const projectName = projectId ? projects.find(p => p.id === projectId)?.name : null
  useDocumentTitle(interventions.length, projectName)

  // Fire a browser notification when a new item lands on the "needs you" queue (#627). Rides the
  // one interventions poll above (the poll stays unconditional — it also feeds the sidebar badge
  // and Overview card); only the notification is gated, on both the category (`notifyHumanIntervention`,
  // default on) and the browser method (`notifyBrowser`).
  const preferences = usePreferences()
  useInterventionNotifications(interventions, humanInterventionEnabled(preferences) && notificationsEnabled(preferences))

  // The "New activity" category (#627): the default-off feed of runs starting/finishing. Its only
  // client consumer is the browser notification below, so it is polled exactly when that will fire —
  // both the category (`notifyNewActivity`) and the browser method (`notifyBrowser`) on. (Discord
  // delivery, if enabled, is the daemon's own watcher, independent of this poll.)
  const browserActivity = newActivityEnabled(preferences) && notificationsEnabled(preferences)
  const { value: activity } = usePolled<Activity[]>(browserActivity ? onActivity : null, EMPTY_ACTIVITY, 15000, [browserActivity])
  useActivityNotifications(activity, browserActivity)

  const onRunStarted = (intent: string, startedId?: string) => {
    // Jump to the new run's live output. Reset to the home/Live row first (a no-op from the launcher,
    // where it already is) so a navbar quick-launch (#723) or resuming a finished run (#720) jumps to
    // live even from a finished run's replay; `followLive` streams that run's feed until the poll
    // surfaces its row below. The new run just appends to the rail; reload so its real
    // row shows up quickly.
    setRunId(null)
    setStartedRunId(startedId ?? null)
    setRunStart(prev => ({ tick: prev.tick + 1, intent }))
    setFollowLive(true)
    reload()
  }

  // Adopt the started run's real id as the selection the moment the poll surfaces it as running,
  // so the view follows its normal running -> done -> replay lifecycle and the rail highlights the
  // run's own row. Until then `followLive` shows the started run's output.
  //
  // Only ever the run we started (#761). This used to take "the running one", which was safe while
  // a project could only have one; with concurrent runs (#736) the previous run is still running
  // and the new one has not written its `run.json` yet, so that guess selected the OLD run and
  // navigated away from the one just started. `startedRunId` is the id the daemon allocated, so
  // there is nothing to infer. A run with no worktree (the non-git fallback) reports no id, and
  // keeps the old behavior — there, one run at a time still holds, so the guess is still safe.
  useEffect(() => {
    if (!followLive) return
    const started = startedRunId
      ? runs.find(run => run.id === startedRunId)
      : runs.find(run => run.status === 'running')
    if (started) {
      setRunId(started.id)
      setFollowLive(false)
    }
  }, [followLive, runs, startedRunId])

  // Selecting a run (or the Live/Home row) from the rail is always an explicit choice, so it
  // ends the just-started follow.
  const selectRun = (id: string | null) => {
    setFollowLive(false)
    setStartedRunId(null)
    setRunId(id)
  }

  const selectProject = (id: string) => {
    setProjectId(id) // persisted, so a refresh returns here
    setRunId(null) // switching projects always returns to the home launcher
    setStartedRunId(null) // and never keeps another project's run in play (#770)
    setFollowLive(false)
    resetContext() // the picked context is the old project's — start fresh
  }

  // The Overview dashboard (#471): no project selected. Clearing projectId forgets the
  // remembered project too, so a refresh lands back on the dashboard, not the last project.
  const showDashboard = () => {
    setProjectId(null)
    setRunId(null)
    setStartedRunId(null)
    setFollowLive(false)
  }

  // The live run feed is owned here so both the main view and the right rail's choice gates
  // (#440) read one shared Telefunc Channel. Hooks run before the relay early return below.
  // The run whose feed and controls are in play. `runId` once the poll has surfaced the run;
  // `startedRunId` covers the gap right after Start, before its row exists (#770). Without that
  // fallback the feed subscribes with no run id, which resolves to the project root — so a new run
  // showed the PREVIOUS run's log for a beat before correcting itself.
  const activeRunId = runId ?? startedRunId
  const events = useLiveEvents(projectId, activeRunId, runStart.tick)
  const choices = projectId ? pendingChoices(events) : []
  const views = projectId ? agentViews(events) : []

  // On the relay (#426), the URL carries `?run=<id>` and there is no local registry or
  // files — show that one run read-only. `window` is absent during prerender (ssr:false),
  // so this resolves to the full shell at build time and only flips in the browser. Hooks
  // above run unconditionally (rules of hooks); this early return is safe after them.
  const relayRun = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('run')
  if (relayRun) return <RelayView runId={relayRun} />

  // Route the main pane: the Overview dashboard when no project is selected (#471); else the
  // project home/launcher, a running run's live output, or a finished run's replay. Each live
  // run streams its own feed and is steered by its own id (#749).
  const selectedRun = runId ? runs.find(run => run.id === runId) : undefined
  const renderMain = () => {
    if (!projectId) return <DashboardPage onSelectProject={selectProject} interventions={interventions} />
    if (runId === null) {
      // Just pressed Start: follow the run's live output until the poll adopts its real id above.
      if (followLive)
        return <RunLive projectId={projectId} runId={activeRunId} events={events} files={files} addContext={addContext} />
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
    }
    if (selectedRun?.status === 'running')
      return <RunLive projectId={projectId} runId={activeRunId} events={events} files={files} addContext={addContext} />
    return <RunReplay projectId={projectId} runId={runId} files={files} addContext={addContext} onRunStarted={onRunStarted} />
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Logo className="h-5 w-auto shrink-0" />
        <span className="shrink-0 font-semibold">The Framework</span>
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <NotificationsMenu />
        </div>
      </header>
      {/* The workspace row is fixed-height: each column scrolls internally, so the row itself
          must never scroll. overflow-hidden clips any stray horizontal bleed (no page X-scroll). */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
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
          onSelect={selectRun}
          startTick={runStart.tick}
          startIntent={runStart.intent}
          followLive={followLive}
        />
        <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
        <RightRail
          projectId={projectId}
          runId={activeRunId}
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
