import { useEffect, useState } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { DocsPanel } from './DocsPanel.js'
import { ProjectLogPanel } from './ProjectLogPanel.js'
import { ChoicesRail } from './ChoicesRail.js'
import { ViewsRail } from './ViewsRail.js'
import type { AgentView } from '../lib/live-state.js'
import { Badge } from './ui/badge.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

type Tab = 'choices' | 'views' | 'docs' | 'log'

// The right sidebar (#314 third rail): the interactive choice gates the run parks on
// (#440), the ad-hoc markdown views the agent pushes (#441), the surfaced docs (PLAN/TODO),
// and the committed project log. Choices/views come from the live event stream, passed
// down from the shell; docs/log are Telefunc-backed reads of the selected project. The rail
// jumps to whatever the run most wants seen: a choice gate first, else a fresh view.
export function RightRail({
  projectId,
  choices,
  views,
}: {
  projectId: string | null
  choices: ChoiceRequest[]
  views: AgentView[]
}) {
  const [tab, setTab] = useState<Tab>('docs')
  const hasChoices = choices.length > 0
  const hasViews = views.length > 0

  // Pull the rail to the most urgent surface: a choice gate over a view over the docs.
  useEffect(() => {
    setTab(hasChoices ? 'choices' : hasViews ? 'views' : 'docs')
  }, [hasChoices, hasViews])

  if (!projectId) return null

  const tabs: Tab[] = [...(hasChoices ? ['choices' as const] : []), ...(hasViews ? ['views' as const] : []), 'docs', 'log']
  const label = (t: Tab) => (t === 'choices' ? 'Choices' : t === 'views' ? 'Views' : t === 'docs' ? 'Docs' : 'Log')
  const count = (t: Tab) => (t === 'choices' ? choices.length : t === 'views' ? views.length : 0)

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border">
      <div className="flex gap-1 border-b border-border p-2">
        {tabs.map(t => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1.5 text-xs', tab === t && 'bg-accent text-accent-foreground')}
            onClick={() => setTab(t)}
          >
            {label(t)}
            {count(t) > 0 && <Badge className="border-primary/40 text-primary">{count(t)}</Badge>}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'choices' && hasChoices ? (
          <ChoicesRail projectId={projectId} choices={choices} />
        ) : tab === 'views' && hasViews ? (
          <ViewsRail views={views} />
        ) : tab === 'log' ? (
          <ProjectLogPanel projectId={projectId} />
        ) : (
          <DocsPanel projectId={projectId} />
        )}
      </div>
    </aside>
  )
}
