import { useEffect, useState } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { DocsPanel } from './DocsPanel.js'
import { ProjectLogPanel } from './ProjectLogPanel.js'
import { ChoicesRail } from './ChoicesRail.js'
import { Badge } from './ui/badge.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

type Tab = 'choices' | 'docs' | 'log'

// The right sidebar (#314 third rail): the interactive choice gates the run parks on
// (#440), the surfaced docs (PLAN/TODO), and the committed project log. Docs/log are
// Telefunc-backed reads of the selected project; the choices come from the live event
// stream, passed down from the shell. The rail jumps to Choices whenever a gate opens so
// the decision is in view.
export function RightRail({ projectId, choices }: { projectId: string | null; choices: ChoiceRequest[] }) {
  const [tab, setTab] = useState<Tab>('docs')
  const hasChoices = choices.length > 0

  // A gate opening pulls the rail to Choices; when the last one clears, fall back to Docs.
  useEffect(() => {
    setTab(hasChoices ? 'choices' : 'docs')
  }, [hasChoices])

  if (!projectId) return null

  const tabs: Tab[] = hasChoices ? ['choices', 'docs', 'log'] : ['docs', 'log']
  const label = (t: Tab) => (t === 'choices' ? 'Choices' : t === 'docs' ? 'Docs' : 'Project log')

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
            {t === 'choices' && <Badge className="border-primary/40 text-primary">{choices.length}</Badge>}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'choices' && hasChoices ? (
          <ChoicesRail projectId={projectId} choices={choices} />
        ) : tab === 'log' ? (
          <ProjectLogPanel projectId={projectId} />
        ) : (
          <DocsPanel projectId={projectId} />
        )}
      </div>
    </aside>
  )
}
