import { type ReactNode } from 'react'
import type { DashboardData, ActiveRun, ProjectStat, ProjectQueue, Intervention } from '@gemstack/framework'
import { FolderGit2, Zap, ListChecks, History, GitPullRequest, Inbox, MessageCircleQuestion } from 'lucide-react'
import { onDashboard } from '../server/reads.telefunc.js'
import { interventionKey } from '../lib/interventions.js'
import { ActivityChart } from './ActivityChart.js'
import { RunOutcomes } from './RunOutcomes.js'
import { UsagePanel } from './UsagePanel.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'

// The Overview dashboard page (#471). What used to be a cramped, collapsible section in the
// first sidebar is now a proper at-a-glance landing: KPI tiles, a two-week activity chart,
// how past runs ended, what the agent is working on right now, and the TODO backlog — all a
// projection of the same files over the `onDashboard` Telefunc read, polled so it stays live.
// Selecting anything here jumps into that project. Shown by the shell when no project is picked.
export function DashboardPage({
  onSelectProject,
  interventions,
}: {
  onSelectProject: (id: string) => void
  interventions: Intervention[]
}) {
  const { value: data } = usePolled<DashboardData | null>(onDashboard, null, 5000, [])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">Everything the agent is doing, across every project.</p>
        </div>

        <NeedsYou items={interventions} onSelectProject={onSelectProject} />

        {data === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile icon={<FolderGit2 className="h-4 w-4" />} label="Projects" value={data.totals.projects} />
              <StatTile
                icon={<Zap className="h-4 w-4" />}
                label="Active sessions"
                value={data.totals.activeRuns}
                accent={data.totals.activeRuns > 0}
              />
              <StatTile icon={<ListChecks className="h-4 w-4" />} label="Open TODOs" value={data.totals.openTodos} />
              <StatTile icon={<History className="h-4 w-4" />} label="Total sessions" value={data.totals.totalRuns} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Session activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityChart data={data.activity} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Session outcomes</CardTitle>
                </CardHeader>
                <CardContent>
                  <RunOutcomes counts={data.runsByStatus} />
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Working now</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <WorkingNow active={data.active} onSelectProject={onSelectProject} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Backlog</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <Backlog queue={data.queue} onSelectProject={onSelectProject} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <ProjectsTable projects={data.projects} onSelectProject={onSelectProject} />
              </CardContent>
            </Card>

            <UsagePanel />
          </>
        )}
      </div>
    </div>
  )
}

// The Queue's "needs you" list (#632, part of #624): the cross-project interventions. Two kinds:
// open PRs to review (proposals + finished work both surface as PRs) — merge to confirm, close to
// reject, so each links straight out to its PR; and runs paused mid-flight on a question (#636),
// which jump into that project's live view to answer. Placed at the top of the Overview as the
// day's actionable inbox; #627 notifications fire off the same set.
function NeedsYou({ items, onSelectProject }: { items: Intervention[]; onSelectProject: (id: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          Needs you
          {items.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
              {items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">You&apos;re all caught up — nothing to review.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map(item => (
              <li key={interventionKey(item)}>
                {item.kind === 'awaiting' ? (
                  <button
                    type="button"
                    onClick={() => onSelectProject(item.projectId)}
                    className="flex w-full items-center gap-2 py-2 text-left hover:opacity-80"
                    title="Open the session to answer"
                  >
                    <MessageCircleQuestion className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="shrink-0 text-xs font-medium text-amber-500">Awaiting</span>
                    <span className="truncate font-medium">{item.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.projectName}</span>
                  </button>
                ) : (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 py-2 hover:opacity-80"
                    title={`Open PR #${item.number} on GitHub`}
                  >
                    <GitPullRequest className="h-4 w-4 shrink-0 text-emerald-500" />
                    <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">#{item.number}</span>
                    <span className="truncate font-medium">{item.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.projectName}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function StatTile({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: ReactNode
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className={cn(accent && 'text-primary')}>{icon}</span>
          {label}
        </div>
        <div className={cn('text-2xl font-semibold tabular-nums', accent && 'text-primary')}>{value}</div>
      </CardContent>
    </Card>
  )
}

function WorkingNow({ active, onSelectProject }: { active: ActiveRun[]; onSelectProject: (id: string) => void }) {
  if (active.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Nothing running.</p>
  }
  return (
    <ul className="divide-y divide-border">
      {active.map(run => (
        // Keyed by project + run (#738): one project can have several runs in flight.
        <li key={`${run.projectId}:${run.runId}`}>
          <button
            type="button"
            onClick={() => onSelectProject(run.projectId)}
            className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:opacity-80"
          >
            <span className="flex w-full items-center gap-1.5">
              {/* Decorative dot + sr-only status (#695/U33): color alone reaches no screen reader. */}
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 rounded-full', run.readyForMerge ? 'bg-emerald-500' : 'animate-pulse bg-amber-500')}
                title={run.readyForMerge ? 'Ready for merge' : 'Building'}
              />
              <span className="sr-only">{run.readyForMerge ? 'Ready for merge' : 'Building'}: </span>
              <span className="truncate font-medium">{run.projectName}</span>
              {run.sessionName && <span className="truncate text-xs text-muted-foreground">{run.sessionName}</span>}
            </span>
            {(run.intent || run.scope) && (
              <span className="truncate pl-3.5 text-xs text-muted-foreground">{run.intent || run.scope}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Backlog({ queue, onSelectProject }: { queue: ProjectQueue[]; onSelectProject: (id: string) => void }) {
  const withOpen = queue.filter(q => q.open > 0)
  if (withOpen.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No open TODOs.</p>
  }
  return (
    <ul className="space-y-2">
      {withOpen.map(q => (
        <li key={q.projectId}>
          <button
            type="button"
            onClick={() => onSelectProject(q.projectId)}
            className="flex w-full items-center gap-2 text-left hover:opacity-80"
          >
            <span className="truncate text-sm font-medium">{q.projectName}</span>
            <span className="ml-auto shrink-0 rounded-full border border-border px-2 text-xs text-muted-foreground">{q.open}</span>
          </button>
          <ul className="mt-1 space-y-0.5 pl-1">
            {q.items
              .filter(i => !i.done)
              .slice(0, 3)
              .map((item, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className="text-muted-foreground/60">▢</span>
                  <span className="truncate" title={item.text}>{item.text}</span>
                </li>
              ))}
            {q.open > 3 && <li className="pl-5 text-xs text-muted-foreground/60">+{q.open - 3} more</li>}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function ProjectsTable({ projects, onSelectProject }: { projects: ProjectStat[]; onSelectProject: (id: string) => void }) {
  if (projects.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No projects yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Project</th>
            <th className="py-2 pr-4 text-right font-medium">Sessions</th>
            <th className="py-2 pr-4 text-right font-medium">TODOs</th>
            <th className="py-2 text-right font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr
              key={p.projectId}
              role="button"
              tabIndex={0}
              onClick={() => onSelectProject(p.projectId)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectProject(p.projectId)
                }
              }}
              className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <td className="py-2 pr-4">
                <span className="flex items-center gap-2">
                  {/* Decorative dot + sr-only status (#695/U33): color alone reaches no screen reader. */}
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      p.running ? 'animate-pulse bg-primary' : p.activated ? 'bg-emerald-500' : 'bg-muted-foreground',
                    )}
                    title={p.running ? 'Running' : p.activated ? 'Activated' : 'Not activated'}
                  />
                  <span className="sr-only">{p.running ? 'Running' : p.activated ? 'Activated' : 'Not activated'}: </span>
                  <span className="truncate font-medium">{p.projectName}</span>
                </span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{p.runs}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{p.openTodos || '—'}</td>
              <td className="py-2 text-right text-xs text-muted-foreground">
                {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
