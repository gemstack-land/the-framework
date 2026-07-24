import { useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown, MonitorSmartphone, Settings, LayoutDashboard, FolderGit2 } from 'lucide-react'
import type { RunMeta, RunStatus, RecentRun, ProjectSummary } from '@gemstack/the-framework'
import { AGENT_LABELS, agentForDriver } from '@gemstack/the-framework/client'
import { Button, buttonVariants } from './ui/button.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'
import { formatRelative } from '../lib/format-date.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { runLabel } from '../lib/run-label.js'
import { AgentLogo } from './agent-logos.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
} from './ui/sidebar.js'
import { ScrollArea } from './ui/scroll-area.js'
// Global chrome relocated off the removed top navbar (#772 follow-up): the sidebar is the app's
// chrome now, so the workspace keeps the full width.
import { BrandLink } from './BrandLink.js'
import { ConnectionIndicator } from './ConnectionIndicator.js'
import { ThemeToggle } from './ThemeToggle.js'
import { NotificationsMenu } from './NotificationsMenu.js'

// One rendered row of the rail, from either source (a project's own run, or a pooled cross-project
// recent): the RunMeta to show, an optional project label (only on the Overview, where the rail
// pools every project), whether it is the selected row, and what selecting it does.
type Row = { key: string; run: RunMeta; project?: string; active: boolean; onClick: () => void }

// The Runs rail (#314 second sidebar), now the shadcn Sidebar (#shared-shell): one component on
// every route, so the home/Overview and a session page share the exact same left column instead of
// the rail vanishing the moment no project is selected. "New" is the permanent home/launcher —
// selecting it shows the Start form + cards (ProjectHome), and it is never consumed by a run. Below
// it sit the recent sessions: a project's own runs when one is selected, and — on the Overview,
// where no project is — every project's sessions pooled newest-first (`recentRuns`), each row
// naming its project and jumping into it when selected. `runs`/`recentRuns` are owned by the shell
// so the rail and the main pane share one list. `startTick`/`startIntent` seed an optimistic
// "starting…" row the instant Start is clicked, until the real run.json lands.
export function RunHistory({
  projectId,
  runs,
  selectedRunId,
  onSelect,
  recentRuns,
  onSelectRecent,
  projects = [],
  onNewSessionInProject,
  onProjectAdded,
  startTick = 0,
  startIntent = '',
  followLive = false,
  working = false,
  onDashboard = () => {},
  onSelectProject = () => {},
  onSettings = () => {},
  interventionCount = 0,
}: {
  projectId: string | null
  runs: RunMeta[]
  selectedRunId: string | null
  onSelect: (runId: string | null) => void
  /** The brand mark animates while any agent is working (moved off the navbar with the brand). */
  working?: boolean
  /** Go to the Overview (no project): the brand mark and the Overview item both call it. Defaults
   *  to a no-op so a focused unit test can mount the rail without wiring the shell's chrome. */
  onDashboard?: () => void
  /** Select a project in the picker (its own element now, not fused with Overview). */
  onSelectProject?: (projectId: string) => void
  /** Open Settings, from the sidebar footer where the navbar gear moved. */
  onSettings?: () => void
  /** Human Queue count, shown on the Overview item and the picker (#632). */
  interventionCount?: number
  /** Cross-project recents for the Overview (no project selected): every project's sessions pooled. */
  recentRuns?: RecentRun[]
  /** Select a pooled recent: jump into its project's session (project + run both change). */
  onSelectRecent?: (projectId: string, runId: string) => void
  /** Every registered project, so "New" knows whether to add one, start in the only one, or pick. */
  projects?: ProjectSummary[]
  /** Start a new session in a project (its launcher). */
  onNewSessionInProject?: (projectId: string) => void
  /** A project was just added, so the shell can refresh its list. */
  onProjectAdded?: () => void
  startTick?: number
  startIntent?: string
  /** Just started a run that reported no id, so there is nothing selected to highlight yet (#705):
   *  put the highlight on the running/optimistic row rather than the New row until the shell adopts
   *  the run's real id. A run that did report one is selected by URL instead (#784). */
  followLive?: boolean
}) {
  const [optimistic, setOptimistic] = useState<string | null>(null)

  useEffect(() => {
    if (startTick > 0) setOptimistic(startIntent)
  }, [startTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRunning = runs.some(run => run.status === 'running')
  const newestRunningId = runs.find(run => run.status === 'running')?.id
  useEffect(() => {
    if (hasRunning) setOptimistic(null)
  }, [hasRunning])
  useEffect(() => {
    setOptimistic(null)
  }, [projectId])
  // A failed start has no running run to hand over to, so without a deadline the row said
  // "starting…" forever (#948). The Start form surfaces the actual error; this just stops
  // the rail pretending.
  useEffect(() => {
    if (optimistic === null || hasRunning) return
    const timer = setTimeout(() => setOptimistic(null), 20_000)
    return () => clearTimeout(timer)
  }, [optimistic, hasRunning])

  // The Overview pools every project's sessions; a selected project shows just its own.
  const crossProject = projectId === null && recentRuns !== undefined
  // On the Overview the optimistic launch row belongs to a project, so it only applies in-project.
  const showOptimistic = !crossProject && optimistic !== null && !hasRunning

  // A session selected but not in the list is one just started, whose row lands with its run.json
  // a beat later (#784): the optimistic row is standing in for it, so highlight that. Following a
  // just-started run (#705) counts too, before its id is known.
  const starting = followLive || (selectedRunId !== null && !runs.some(run => run.id === selectedRunId))

  const rows: Row[] = crossProject
    ? recentRuns!.map(rr => ({
        key: `${rr.projectId}:${rr.run.id}`,
        run: rr.run,
        project: rr.projectName,
        active: false, // nothing is selected on the Overview; a row navigates into its project
        onClick: () => onSelectRecent?.(rr.projectId, rr.run.id),
      }))
    : runs.map(run => ({
        key: run.id,
        run,
        // Following live highlights the newest running run, not every one of them (#738):
        // `runs` is newest-first, so that is the first with a running status.
        active: run.id === selectedRunId || (followLive && run.id === newestRunningId),
        onClick: () => onSelect(run.id),
      }))

  // New is the active view when a project is open on its launcher (its "New" / Start-a-session
  // screen: a project selected, no run picked, not following a live one). On the Overview that role
  // belongs to the Overview item instead, so the two are never active at once.
  const atProjectLauncher = projectId !== null && selectedRunId === null && !followLive

  const hasRecents = rows.length > 0 || showOptimistic

  return (
    // A fixed-width, in-flow column (`collapsible="none"`): with the top navbar gone (#772
    // follow-up), the sidebar carries the app's chrome — brand, global nav, and the utility
    // controls in the footer — so the workspace and right rail get the full height.
    <Sidebar collapsible="none" className="w-(--sidebar-width) border-r border-sidebar-border">
      <SidebarHeader className="gap-0.5 pb-2">
        {/* The mark + wordmark, the way home (#909), now that there is no navbar to hold them.
            A clear gap below it pushes New down; then New/Overview/Projects stack tight as one nav
            group (gap-0.5), with a little space again below the group (the header's pb-2) before
            Recents. */}
        <div className="px-1 pt-1 pb-4">
          <BrandLink working={working} onNavigate={onDashboard} />
        </div>
        {/* "New" starts a session — but where depends on what exists: with no project it prompts to
            add one first, with one project it starts there, with several it opens a picker. In a
            project already, it just starts another session there. */}
        <NewButton
          projectId={projectId}
          projects={projects}
          active={atProjectLauncher}
          onNewSessionInProject={onNewSessionInProject}
          onSelect={onSelect}
          onProjectAdded={onProjectAdded}
        />
        {/* Overview: the way home, its own nav item directly under New and above the session list,
            more prominent than a menu row. Only this — the current view — carries the active fill. */}
        <OverviewButton active={projectId === null} count={interventionCount} onClick={onDashboard} />
        {/* Projects: its own nav item under Overview, same row style, expanding to an indented list
            of projects (not a dropdown). Selecting one navigates into it — the interim, until the
            filter-vs-navigate call is made. */}
        <ProjectsNav
          projects={projects}
          selectedId={projectId}
          onSelect={onSelectProject}
          onProjectAdded={onProjectAdded}
        />
      </SidebarHeader>
      {/* The themed ScrollArea (#913) instead of the sidebar's native overflow bar, matching the
          Overview: suppress SidebarContent's own `overflow-auto` and let the ScrollArea own it. */}
      <SidebarContent className="overflow-hidden">
        <ScrollArea className="min-h-0 flex-1">
          {/* pr-3 keeps the rows (and the active card) clear of the overlaid scrollbar (w-2.5). */}
          <SidebarGroup className="pt-1 pr-3">
            {/* Recents label sits under the launcher, over the run list (not a page-wide header). */}
            {hasRecents && (
              <SidebarGroupLabel className="mt-2 font-normal uppercase tracking-wide text-muted-foreground">Recents</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {/* A just-started run, before its run.json exists — highlighted while following it. */}
                {showOptimistic && (
                  <SidebarMenuItem>
                    <RunRow status="running" intent={optimistic ?? undefined} subtitle="starting…" active={starting} dim onClick={() => onSelect(null)} />
                  </SidebarMenuItem>
                )}
                {rows.map(row => (
                  <SidebarMenuItem key={row.key}>
                    <RunRow
                      status={row.run.status}
                      intent={runLabel(row.run)}
                      driver={row.run.driver}
                      // On the Overview the project is what tells the rows apart, so it leads the meta
                      // line; a project's own rail already knows its project, so it shows just the time.
                      subtitle={row.project ? `${row.project} · ${formatRelative(row.run.startedAt)}` : formatRelative(row.run.startedAt)}
                      active={row.active}
                      waiting={row.run.settledAt !== undefined}
                      remote={row.run.target === 'remote'}
                      {...(row.run.remoteLabel ? { remoteLabel: row.run.remoteLabel } : {})}
                      onClick={row.onClick}
                    />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {!hasRecents && (
                <p className="whitespace-nowrap px-2 py-1 text-sm text-muted-foreground">No sessions yet.</p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>
      {/* The navbar's utility controls, relocated to the foot of the sidebar (#772 follow-up):
          which daemon this is (Local/remote), theme, notifications, and Settings. */}
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-1">
          <ConnectionIndicator />
          <div className="min-w-0 flex-1" />
          <ThemeToggle />
          <NotificationsMenu />
          <Button variant="ghost" size="sm" onClick={onSettings} title="Settings" aria-label="Settings">
            <Settings className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

// The Overview entry (Rom): the way home, pinned above the session list and more prominent than a
// menu row. Carries the Human Queue count (#632) so the one cross-project signal stays visible, and
// highlights while it is the current view.
function OverviewButton({ active, count, onClick }: { active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // Same box as New (px-2 py-1.5 gap-2) so the two rows' icons and labels line up exactly.
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-foreground hover:bg-sidebar-accent/60',
      )}
    >
      <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 text-left">Overview</span>
      {count > 0 && (
        <span
          className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground tabular-nums"
          title={`${count} item${count === 1 ? '' : 's'} in your Human Queue`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// Projects: the project selector as an expandable nav item (Rom), the same row style as Overview,
// opening an indented sub-list rather than a dropdown. Selecting a project navigates into it (the
// interim behaviour; the filter-vs-navigate call is still open). Starts collapsed — you open it to
// switch projects. Uses the `projects` the shell already loaded.
function ProjectsNav({
  projects,
  selectedId,
  onSelect,
  onProjectAdded,
}: {
  projects: ProjectSummary[]
  selectedId: string | null
  onSelect: (projectId: string) => void
  onProjectAdded?: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-sidebar-accent/60"
      >
        <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Projects</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 opacity-70 transition-transform', open || '-rotate-90')} aria-hidden />
      </button>
      {open && (
        // The indented sub-list, with the connecting rule the reference draws down the group.
        <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
          {projects.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No projects yet</p>}
          {projects.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              aria-current={p.id === selectedId ? 'page' : undefined}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                p.id === selectedId
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-foreground hover:bg-sidebar-accent/60',
              )}
            >
              {/* The activated dot the picker used, kept so the two project lists still read alike. */}
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 rounded-full', p.activated ? 'bg-primary' : 'bg-muted-foreground')}
                title={p.activated ? 'activated' : 'not activated'}
              />
              <span className="sr-only">{p.activated ? 'Activated' : 'Not activated'}: </span>
              <span className="flex-1 truncate text-left">{p.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Add project</span>
          </button>
        </div>
      )}
      {adding && <AddProjectPanel onAdded={() => onProjectAdded?.()} onClose={() => setAdding(false)} />}
    </div>
  )
}

// The "New" launcher, project-count aware (#new-button). In a project, it starts another session
// there. On the Overview it adapts to how many projects exist: none -> open the add-project dialog
// (you cannot start a session with nowhere to run it); one -> start there; several -> a small picker
// so you choose where. The label + Plus stay the same in every case, so it reads as one button.
function NewButton({
  projectId,
  projects,
  active = false,
  onNewSessionInProject,
  onSelect,
  onProjectAdded,
}: {
  projectId: string | null
  projects: ProjectSummary[]
  /** On a project's launcher (its "New" screen), so New reads as the current view. Off on the
   *  Overview, where the Overview item is the active one instead — the two are never both active. */
  active?: boolean
  onNewSessionInProject?: ((projectId: string) => void) | undefined
  onSelect: (runId: string | null) => void
  onProjectAdded?: (() => void) | undefined
}) {
  const [adding, setAdding] = useState(false)
  // Same box as the Overview row (px-2 py-1.5 gap-2) so their icons and labels align; h-auto/px-2/
  // py-1.5 override the button size's default h-9/px-4/py-2. The active fill (same tokens as
  // Overview) only on this project's launcher; otherwise plain, since New is an action, not a place.
  const cls = cn(
    'h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal',
    active && 'bg-sidebar-accent text-sidebar-accent-foreground',
  )
  const start = (id: string) => (onNewSessionInProject ? onNewSessionInProject(id) : onSelect(null))

  // In a project, or on the Overview with exactly one: start a session straight away.
  if (projectId !== null || projects.length === 1) {
    const target = projectId ?? projects[0]!.id
    return (
      <Button variant="ghost" className={cls} onClick={() => start(target)}>
        <Plus className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">New</span>
      </Button>
    )
  }

  // No projects: there is nowhere to run a session, so prompt to add one first.
  if (projects.length === 0) {
    return (
      <>
        <Button variant="ghost" className={cls} onClick={() => setAdding(true)} title="Add a project to start a session">
          <Plus className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">New</span>
        </Button>
        {adding && <AddProjectPanel onAdded={() => onProjectAdded?.()} onClose={() => setAdding(false)} />}
      </>
    )
  }

  // Several projects: pick which one the new session runs in.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="New session" className={cn(buttonVariants({ variant: 'ghost' }), cls)}>
        <Plus className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">New</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[13.5rem]">
        {projects.map(p => (
          <DropdownMenuItem key={p.id} onClick={() => start(p.id)}>
            {/* Match the picker's activated dot so the two project lists read the same (#695/U33). */}
            <span
              aria-hidden
              className={cn('h-2 w-2 shrink-0 rounded-full', p.activated ? 'bg-primary' : 'bg-muted-foreground')}
            />
            <span className="flex-1 truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One run row: a pulsing dot + RUNNING badge for a working run, a still dot + WAITING for one
// parked on the user (#785), else the terminal-status badge.
function RunRow({
  status,
  intent,
  subtitle,
  active,
  onClick,
  driver,
  dim = false,
  waiting = false,
  remote = false,
  remoteLabel,
}: {
  status: RunStatus
  intent: string | undefined
  subtitle: string
  /** The agent that ran it, so the row can show whose session it was. */
  driver?: string | undefined
  active: boolean
  onClick: () => void
  dim?: boolean
  /** Live, but parked on the user rather than working (#785). */
  waiting?: boolean
  /** Runs on a connected device (#1067): the row gets a device glyph next to the agent logo. */
  remote?: boolean
  /** The device's label, for the glyph's tooltip. */
  remoteLabel?: string | undefined
}) {
  // Only a live run can be waiting on you; a finished one is just finished.
  const parked = waiting && status === 'running'
  const agent = agentForDriver(driver)
  // The title only fades + marquees when it actually overflows the fixed-width rail; a short one
  // shows plainly. Measured here since CSS cannot tell. The rail width is fixed, so intent is the
  // only thing that changes the answer.
  const titleRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = titleRef.current
    if (el) setOverflowing(el.scrollWidth > el.clientWidth + 1)
  }, [intent])
  return (
    <Button
      variant="ghost"
      className={cn(
        // px-0 (overriding the button base's px-4) so the card has no horizontal padding: the title
        // spans edge to edge and its clip/fade land on the border. Inner rows carry their own px-2.
        'rail-row h-auto w-full flex-col items-start gap-0.5 px-0 py-2 text-left',
        active && 'bg-accent text-accent-foreground',
        dim && 'opacity-70',
      )}
      onClick={onClick}
    >
      <span className="flex w-full items-center gap-2 px-2">
        {/* The dot means "the agent is working", so a run parked on you gets a still one (#785):
            it used to pulse identically whether it was mid-edit or had been idle for an hour. */}
        {status === 'running' && (
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', parked ? 'bg-muted-foreground' : 'animate-pulse bg-primary')} />
        )}
        <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', parked ? 'text-muted-foreground' : STATUS_TONE[status])}>
          {parked ? 'waiting' : status}
        </Badge>
        <span className="truncate text-xs font-normal text-muted-foreground">{subtitle}</span>
        {/* Right cluster: a device glyph when the run is relayed to a connected device (#1067),
            then the agent logo. The logo is the only thing naming the agent on this row, so it
            carries a title rather than being decorative. */}
        {(remote || agent) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {remote && (
              <span title={remoteLabel ? `Runs on ${remoteLabel}` : 'Runs on a connected device'} className="flex items-center">
                <MonitorSmartphone className="h-3 w-3 text-muted-foreground" aria-label={remoteLabel ? `Runs on ${remoteLabel}` : 'Runs on a connected device'} />
              </span>
            )}
            {agent && <AgentLogo agent={agent} title={AGENT_LABELS[agent]} className="h-3 w-3 text-muted-foreground" />}
          </span>
        )}
      </span>
      <span ref={titleRef} className={cn('rail-title w-full px-2 text-sm font-normal', overflowing && 'is-overflowing')}>
        <span className="rail-title-inner">{intent || 'New session'}</span>
      </span>
    </Button>
  )
}
