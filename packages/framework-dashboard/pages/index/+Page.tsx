import { useEffect, useState } from 'react'
import type { Intervention, Activity, ProjectSummary, RecentRun } from '@gemstack/the-framework'
import { onProjectFiles, onInterventions, onActivity, onRecentRuns } from '../../server/reads.telefunc.js'
import { onProjects } from '../../server/projects.telefunc.js'
import { ProjectPicker } from '../../components/ProjectPicker.js'
import { BrandLink } from '../../components/BrandLink.js'
import { ThemeToggle } from '../../components/ThemeToggle.js'
import { ConnectionIndicator } from '../../components/ConnectionIndicator.js'
import { NotificationsMenu } from '../../components/NotificationsMenu.js'
import { Button } from '../../components/ui/button.js'
import { RunHistory } from '../../components/RunHistory.js'
import { SidebarProvider } from '../../components/ui/sidebar.js'
import { ProjectHome } from '../../components/ProjectHome.js'
import { DashboardPage } from '../../components/DashboardPage.js'
import { SettingsPage } from '../../components/SettingsPage.js'
import { RunView } from '../../components/RunView.js'
import { runLabel } from '../../lib/run-label.js'
import { RightRail } from '../../components/RightRail.js'
import { RelayView } from '../../components/RelayView.js'
import { NotFound } from '../../components/NotFound.js'
import { useLiveEvents } from '../../lib/use-live-events.js'
import { useRuns } from '../../lib/use-runs.js'
import { useLoaded, usePolled } from '../../lib/use-async.js'
import { useRoute } from '../../lib/use-route.js'
import { useContextSet } from '../../lib/use-context-set.js'
import { useActivityNotifications, useInterventionNotifications } from '../../lib/use-notifications.js'
import { usePreferences, notificationsEnabled, newActivityEnabled, humanInterventionEnabled } from '../../lib/preferences.js'
import { pendingChoices, agentViews } from '../../lib/live-state.js'
import { useDocumentTitle } from '../../lib/document-title.js'
import { useWorking } from '../../lib/use-working.js'
import { useFavicon } from '../../lib/favicon.js'
import { useDaemonHealth } from '../../lib/use-daemon-health.js'
import { TriangleAlert, Settings } from 'lucide-react'

/** Stable, so `files` keeps one identity while no project is selected. */
const EMPTY_FILES: string[] = []

/** Stable initial for the projects load, so it does not churn on every render. */
const EMPTY_PROJECTS: ProjectSummary[] = []

/** Stable initial for the interventions poll, so it does not churn on every render. */
const EMPTY_INTERVENTIONS: Intervention[] = []

/** Stable initial for the activity poll (#627), so it does not churn on every render. */
const EMPTY_ACTIVITY: Activity[] = []

/** Stable initial for the cross-project recents poll, so it does not churn on every render. */
const EMPTY_RECENT: RecentRun[] = []

// The dashboard shell (#405 phase 2): Sessions | main | Docs/Log rail, with the project
// selection in the top nav as a dropdown since #772 (it used to be a rail of its own). The main pane
// is one of three views chosen by the selection: the project home/launcher (Live, the default —
// Start form + cards) or one session's own view (RunView), live or finished — the same frame
// either way (#1026). Everything over the wire is Telefunc. A projection of the same .the-framework
// files the daemon writes.
//
// The selection IS the URL (#784): `/` the Overview, `/{projectId}` the project home,
// `/{projectId}/{sessionId}` one session. It used to be three pieces of React state — the
// selected run, the just-started run, and a "follow the live feed" flag — reconciled at render,
// and each of #761/#766/#768/#774 was a case where they disagreed about which run was in play.
// A route cannot disagree with itself, and a session becomes a link: paste it, reload it,
// bookmark it, open two side by side. A refresh returns to the same project for free, which is
// what the remembered-project state (#475) was for.
export default function Page() {
  const { route, go } = useRoute()
  const { view, projectId, runId } = route

  // A just-started run: bump the tick so the Sessions rail shows an optimistic "starting…" row
  // with the typed prompt at once, before the spawned process writes its run.json. `id` is the
  // one the daemon allocated for it (#761) — the URL already points there, and this is what tells
  // the main pane that a session missing from the list is starting, not gone.
  // `runsOn` names the device a just-started remote run executes on (#1067), so the live view can
  // mark where it runs and degrade the panels that are local-only. Undefined for a local run.
  const [runStart, setRunStart] = useState<{ tick: number; intent: string; id: string | null; runsOn?: string }>({ tick: 0, intent: '', id: null })
  // A project with no git checkout gets no worktree, so Start hands back no id and there is
  // nothing to navigate to yet. That fallback is one run at a time (daemon.ts keys the busy guard
  // by project there), so "the running one" is still a safe guess — adopt it the moment the poll
  // surfaces it. This is the one place the selection is still inferred, and only where it can't
  // be known.
  const [adopting, setAdopting] = useState(false)

  const { runs, reload, loaded: runsLoaded } = useRuns(projectId)

  // The run Context set lives in the shell (#492/#504) so the two surfaces that feed it share
  // one source of truth: the `#` file chips + whole-repo Context selector in the Start form
  // (main pane), and the file tree in the right rail.
  const { context, add: addContext, remove: removeContext, toggle: toggleContext, reset: resetContext } = useContextSet()

  // The picked context is one project's, so changing projects starts fresh. Keyed off the route
  // rather than the click, because Back/Forward change projects too.
  useEffect(() => {
    resetContext()
    // `resetContext` is a fresh closure each render; the project is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // The selected project's files (git ls-files), handed to both the `#` picker and the tree.
  // Empty when no project / on the relay (no checkout). Scoped to the selected session's
  // worktree (#815), the same checkout the action bar's branch, Serve and open-folder act on;
  // polled so a file the run creates shows up rather than waiting for a reload.
  const { value: files } = usePolled<string[]>(
    projectId ? () => onProjectFiles(projectId, runId ?? undefined) : null,
    EMPTY_FILES,
    10_000,
    [projectId, runId],
  )

  // The cross-project "needs you" queue (#632): open PRs to review. Polled here in the shell so
  // the sidebar badge and the Overview card share one poll. Slow cadence — PRs change rarely and
  // each poll spawns `gh` per project.
  const { value: interventions } = usePolled<Intervention[]>(onInterventions, EMPTY_INTERVENTIONS, 15000, [])

  // The registered projects, loaded once for the browser-tab title (#695/U3): the selected
  // project's name plus the needs-you count drive `document.title` so a backgrounded tab tells
  // you which project needs attention. The sidebar keeps its own poll; this is a cheap one-shot.
  // Reloadable so adding a project from the sidebar's "New" reflects at once (bump the key).
  const [projectsKey, setProjectsKey] = useState(0)
  const projects = useLoaded<ProjectSummary[]>(onProjects, EMPTY_PROJECTS, [projectsKey])
  const projectName = projectId ? projects.find(p => p.id === projectId)?.name : null
  useDocumentTitle(interventions.length, projectName)
  // A URL naming a project that is not registered (renamed, removed, mistyped). A non-empty list
  // is the answer, so this never fires while the one-shot read is still out.
  const unknownProject = projectId !== null && projects.length > 0 && !projects.some(p => p.id === projectId)

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

  // The shared sidebar's recents on the Overview (#shared-shell): with no project selected the rail
  // has no project runs to show, so it pools every project's sessions here. Polled only on the home
  // route — a selected project's own `runs` (above) carry its rail.
  const { value: recentRuns } = usePolled<RecentRun[]>(projectId === null ? onRecentRuns : null, EMPTY_RECENT, 10_000, [projectId])

  const onRunStarted = (intent: string, startedId?: string, runsOn?: string) => {
    setRunStart(prev => ({ tick: prev.tick + 1, intent, id: startedId ?? null, ...(runsOn ? { runsOn } : {}) }))
    setAdopting(startedId === undefined)
    // The picked context went with that run; the next launch starts from a clean focus (#948).
    resetContext()
    // Go to the run we just started — a real history entry, so Back returns to where you launched
    // from. Its row does not exist yet; the main pane shows it live on the strength of the id.
    if (startedId !== undefined) go({ projectId, runId: startedId })
    // The new run just appends to the rail; reload so its real row shows up quickly.
    reload()
  }

  // The no-id fallback only: adopt the running run as the selection once the poll surfaces it.
  // A correction rather than a step, so it replaces the history entry.
  useEffect(() => {
    if (!adopting) return
    const running = runs.find(run => run.status === 'running')
    if (!running) return
    setAdopting(false)
    go({ projectId, runId: running.id }, { replace: true })
    // `go` is a fresh closure each render; the route it needs is in the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adopting, runs, projectId])

  // Selecting a session (or the Live/Home row) is always an explicit choice, so it ends the
  // just-started follow.
  const selectRun = (id: string | null) => {
    setAdopting(false)
    go({ projectId, runId: id })
  }

  const selectProject = (id: string) => {
    setAdopting(false)
    go({ projectId: id, runId: null }) // switching projects always returns to the home launcher
  }

  // "New" in the sidebar: start a fresh session in a named project (the sidebar decides which —
  // the current one, the only one, or a picked one). resetContext explicitly, since staying in the
  // same project would not trip the project-change effect above.
  const newSessionInProject = (id: string) => {
    setAdopting(false)
    resetContext()
    go({ projectId: id, runId: null })
  }

  // The Overview dashboard (#471): no project selected.
  const showDashboard = () => {
    setAdopting(false)
    go({ projectId: null, runId: null })
  }

  // The settings page (#958): every setting in one place, plus the Onboarding checklist, which is
  // where dismissing it from the Overview says you can pick it back up.
  const showSettings = () => {
    setAdopting(false)
    go({ view: 'settings', projectId: null, runId: null })
  }

  // The live run feed is owned here so both the main view and the right rail's choice gates
  // (#440) read one shared Telefunc Channel. Hooks run before the relay early return below.
  // The run whose feed and controls are in play is simply the one in the URL; in the no-id
  // fallback there is none yet, and a null id resolves to the project root, as before.
  const { events, lost } = useLiveEvents(projectId, runId, runStart.tick)
  const choices = projectId ? pendingChoices(events) : []
  const views = projectId ? agentViews(events) : []

  // On the relay (#426), the URL carries `?run=<id>` and there is no local registry or
  // files — show that one run read-only. `window` is absent during prerender (ssr:false),
  // so this resolves to the full shell at build time and only flips in the browser.
  const relayRun = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('run')

  // Is an agent working (#875)? Drives the mark and the tab icon. Both off on the relay: there is
  // no project registry behind it, so the cross-project read cannot answer, and RelayView owns
  // both from its one run's feed instead.
  const local = relayRun === null
  const working = useWorking(local)
  useFavicon(working, local)

  // Whether the daemon answers at all (#948). Without this, a dead daemon froze every surface
  // silently: the channels retry their transport without a verdict and the polls keep their
  // last value, so "the agent went quiet" and "nothing on this page is live" looked identical.
  const healthy = useDaemonHealth(local)

  // Hooks above run unconditionally (rules of hooks); this early return is safe after them.
  if (relayRun) return <RelayView runId={relayRun} />

  // Route the main pane: the Overview dashboard when no project is selected (#471); else the
  // project home/launcher, a running run's live output, or a finished run's replay. Each live
  // run streams its own feed and is steered by its own id (#749).
  const selectedRun = runId ? runs.find(run => run.id === runId) : undefined
  const renderMain = () => {
    if (view === 'settings') return <SettingsPage onSelectProject={selectProject} onDone={showDashboard} />
    if (!projectId) return <DashboardPage onSelectProject={selectProject} interventions={interventions} />
    if (unknownProject)
      return (
        <NotFound
          title="No such project"
          detail={`No project is registered as "${projectId}". It may have been removed, or the link may be from another machine.`}
          actionLabel="Go to the Overview"
          onAction={showDashboard}
        />
      )
    if (runId === null) {
      // Just pressed Start on a project with no worktree: follow the live output until the poll
      // surfaces the run and the effect above adopts its id.
      if (adopting) return <RunView projectId={projectId} runId={null} events={events} live label={runStart.intent || undefined} remoteLabel={runStart.runsOn} files={files} addContext={addContext} removeContext={removeContext} lost={lost} onRunStarted={onRunStarted} />
      return (
        <ProjectHome
          projectId={projectId}
          events={events}
          onRunStarted={onRunStarted}
          files={files}
          context={context}
          addContext={addContext}
          removeContext={removeContext}
          toggleContext={toggleContext}
        />
      )
    }
    if (!selectedRun) {
      // Not in the list: either the run we just started (its run.json lands a beat later) or a
      // list we have not read yet. Both are live views; only a session that is genuinely absent
      // from a list we did read is gone.
      if (runId === runStart.id || !runsLoaded)
        return <RunView projectId={projectId} runId={runId} events={events} live label={runStart.intent || undefined} remoteLabel={runId === runStart.id ? runStart.runsOn : undefined} files={files} addContext={addContext} removeContext={removeContext} lost={lost} onRunStarted={onRunStarted} />
      return (
        <NotFound
          title="This session is gone"
          detail="It is not in this project's sessions. A session disappears when its worktree is removed."
          actionLabel="Back to the project"
          onAction={() => selectRun(null)}
        />
      )
    }
    // Live and finished are the same view (#1026): only `live` changes, so a run ending swaps
    // what the bar, feed and composer say without remounting any of them.
    return (
      <RunView
        projectId={projectId}
        runId={runId}
        events={events}
        live={selectedRun.status === 'running'}
        label={runLabel(selectedRun)}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        lost={lost}
        target={selectedRun.target}
        remoteLabel={selectedRun.remoteLabel}
        onRunStarted={onRunStarted}
        onDeleted={() => {
          // Its view is about to point at a session that no longer exists; go home and refresh
          // the rail so the row is gone (#1032).
          selectRun(null)
          reload()
        }}
      />
    )
  }

  return (
    // The whole shell lives inside the SidebarProvider so the sidebar's context (state + Cmd/Ctrl+B,
    // the `--sidebar-width` var) is available on every route, home and session alike. Its wrapper is
    // the column that used to be a plain div.
    <SidebarProvider className="h-screen flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <BrandLink working={working} onNavigate={showDashboard} />
        {/* The project selection lives in the nav now (#772), not in a rail of its own: always
            shown, on every page including the Overview. Nudged off the brand mark so the two do
            not read as one unit. */}
        <div className="ms-10">
          <ProjectPicker
            selectedId={projectId}
            onSelect={selectProject}
            onDashboard={showDashboard}
            interventionCount={interventions.length}
          />
        </div>
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          {/* Which daemon this dashboard is talking to (#1052) — obvious once you can hop devices. */}
          <ConnectionIndicator />
          <ThemeToggle />
          <NotificationsMenu />
          <Button variant="ghost" size="sm" onClick={showSettings} title="Settings" aria-label="Settings">
            <Settings className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>
      {!healthy && (
        <div role="alert" className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          The daemon is not answering — retrying. Everything on this page is frozen until it returns.
        </div>
      )}
      {/* The workspace row is fixed-height: each column scrolls internally, so the row itself
          must never scroll. overflow-hidden clips any stray horizontal bleed (no page X-scroll).
          `relative` is load-bearing (#904): overflow only clips a descendant this box is the
          containing block for, and Tailwind's `.sr-only` is position:absolute. Without it those
          labels resolve against the initial containing block, keep their static position deep in
          the scrolled content, and give the document a phantom scrollbar that slides the whole
          app off-screen. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <RunHistory
          projectId={projectId}
          runs={runs}
          selectedRunId={runId}
          onSelect={selectRun}
          recentRuns={recentRuns}
          onSelectRecent={(pid, rid) => {
            setAdopting(false)
            go({ projectId: pid, runId: rid })
          }}
          projects={projects}
          onNewSessionInProject={newSessionInProject}
          onProjectAdded={() => {
            setProjectsKey(k => k + 1)
            reload()
          }}
          startTick={runStart.tick}
          startIntent={runStart.intent}
          followLive={adopting}
        />
        <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
        <RightRail
          projectId={projectId}
          runId={runId}
          choices={choices}
          views={views}
          files={files}
          context={context}
          toggleContext={toggleContext}
          hasBrowser={selectedRun?.status === 'running' && selectedRun.browserStreamPort !== undefined}
          target={selectedRun?.target}
          onRunStarted={onRunStarted}
        />
      </div>
    </SidebarProvider>
  )
}
