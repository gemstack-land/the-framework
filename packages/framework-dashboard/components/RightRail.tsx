import { useEffect, useRef, useState } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { DocsPanel } from './DocsPanel.js'
import { ProjectLogPanel } from './ProjectLogPanel.js'
import { ChoicesRail } from './ChoicesRail.js'
import { ViewsRail } from './ViewsRail.js'
import { FileTree } from './FileTree.js'
import { BrowserPanel } from './BrowserPanel.js'
import { TicketsPanel } from './TicketsPanel.js'
import type { AgentView } from '../lib/live-state.js'
import { Badge } from './ui/badge.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

type Tab = 'files' | 'choices' | 'views' | 'browser' | 'tickets' | 'docs' | 'log'

// The right sidebar (#314 third rail): the interactive choice gates the run parks on
// (#440), the ad-hoc markdown views the agent pushes (#441), the surfaced docs (PLAN/TODO),
// and the committed project log. Choices/views come from the live event stream, passed
// down from the shell; docs/log are Telefunc-backed reads of the selected project. The rail
// jumps to whatever the run most wants seen: a choice gate first, else a fresh view.
export function RightRail({
  projectId,
  runId,
  choices,
  views,
  files,
  context,
  toggleContext,
  hasBrowser = false,
  onRunStarted,
}: {
  projectId: string | null
  /** The selected run: resolves a choice pick's gate (#749) and scopes the tree to its worktree (#815). */
  runId?: string | null | undefined
  choices: ChoiceRequest[]
  views: AgentView[]
  /** The project's files for the Files tab tree (#492); empty on the relay. */
  files: string[]
  /** The run Context set, shared with the Start form (#504). */
  context: Set<string>
  /** Toggle a file path in the Context. */
  toggleContext: (path: string) => void
  /** Whether the selected run is serving a browser preview (#813), i.e. it was started with Browser on. */
  hasBrowser?: boolean
  /** Told when a panel starts a session (the tickets import, #948), so the shell shows it. */
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
}) {
  const [tab, setTab] = useState<Tab>('docs')
  // Once the user picks a tab, stop auto-defaulting (#695/U22) — only a genuinely new choice
  // gate or the first view may still pull focus after that.
  const touched = useRef(false)
  const pickTab = (t: Tab) => {
    touched.current = true
    setTab(t)
  }
  const hasChoices = choices.length > 0
  const hasViews = views.length > 0
  const hasFiles = files.length > 0

  // Only pull the rail for something genuinely new (#695/U22): a fresh choice gate (an id we
  // haven't shown) or the first view. A resolving gate, a second view, or a Files flip no longer
  // yanks the tab you're reading, and an explicit pick is never overridden by the browse default.
  const seenChoiceIds = useRef<Set<string>>(new Set())
  const sawView = useRef(false)
  useEffect(() => {
    const freshChoice = choices.some(c => !seenChoiceIds.current.has(c.id))
    for (const c of choices) seenChoiceIds.current.add(c.id)
    const firstView = hasViews && !sawView.current
    sawView.current = sawView.current || hasViews

    if (freshChoice) setTab('choices')
    else if (firstView) setTab('views')
    else if (!touched.current && !hasChoices && !hasViews) setTab(hasFiles ? 'files' : 'docs')
  }, [choices, hasChoices, hasViews, hasFiles])

  if (!projectId) return null

  // Files first (#492): the project peek surface, before the run's own choices/views/docs/log.
  const tabs: Tab[] = [
    ...(hasFiles ? ['files' as const] : []),
    ...(hasChoices ? ['choices' as const] : []),
    ...(hasViews ? ['views' as const] : []),
    // Only when the run actually has one (#813) — a dead tab teaches people the preview is broken.
    ...(hasBrowser && runId ? ['browser' as const] : []),
    'tickets',
    'docs',
    'log',
  ]
  const label = (t: Tab) =>
    t === 'files'
      ? 'Files'
      : t === 'choices'
        ? 'Choices'
        : t === 'views'
          ? 'Views'
          : t === 'browser'
            ? 'Browser'
            : t === 'tickets'
              ? 'Tickets'
              : t === 'docs'
                ? 'Docs'
                : 'Log'
  // The Files badge counts only selected files, not whole-repo entries (#661): the shared context
  // set also holds project paths (from the Start form's repo checkboxes), which aren't in `files`.
  const selectedFiles = files.filter(f => context.has(f)).length
  const count = (t: Tab) => (t === 'choices' ? choices.length : t === 'views' ? views.length : t === 'files' ? selectedFiles : 0)

  return (
    <aside
      className={cn(
        'flex w-[27rem] shrink-0 flex-col border-l border-border',
      )}
    >
      {/* flex-wrap: up to 7 tabs share a w-80 rail, and without it the tail clipped (#948).
          Announced as the tabset it visually is. */}
      <div role="tablist" aria-label="Rail panels" className="flex flex-wrap gap-1 border-b border-border p-2">
        {tabs.map(t => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1.5 text-xs', tab === t && 'bg-accent text-accent-foreground')}
            onClick={() => pickTab(t)}
          >
            {label(t)}
            {count(t) > 0 && <Badge className="border-primary/40 text-primary">{count(t)}</Badge>}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'files' && hasFiles ? (
          <FileTree projectId={projectId} runId={runId} files={files} selected={context} onToggle={toggleContext} />
        ) : tab === 'choices' && hasChoices ? (
          <ChoicesRail projectId={projectId} runId={runId} choices={choices} />
        ) : tab === 'views' && hasViews ? (
          <ViewsRail views={views} />
        ) : tab === 'browser' && hasBrowser && runId ? (
          <BrowserPanel projectId={projectId} runId={runId} />
        ) : tab === 'tickets' ? (
          <TicketsPanel projectId={projectId} onRunStarted={onRunStarted} />
        ) : tab === 'log' ? (
          <ProjectLogPanel projectId={projectId} />
        ) : (
          <DocsPanel projectId={projectId} />
        )}
      </div>
    </aside>
  )
}
