import { useState } from 'react'
import { DocsPanel } from './DocsPanel.js'
import { ProjectLogPanel } from './ProjectLogPanel.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// The right sidebar (#314 third rail): tabs between the surfaced docs (PLAN/TODO) and
// the committed project log. Both are Telefunc-backed reads of the selected project.
export function RightRail({ projectId }: { projectId: string | null }) {
  const [tab, setTab] = useState<'docs' | 'log'>('docs')
  if (!projectId) return null

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border">
      <div className="flex gap-1 border-b border-border p-2">
        {(['docs', 'log'] as const).map(t => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            className={cn('h-7 text-xs capitalize', tab === t && 'bg-accent text-accent-foreground')}
            onClick={() => setTab(t)}
          >
            {t === 'docs' ? 'Docs' : 'Project log'}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'docs' ? <DocsPanel projectId={projectId} /> : <ProjectLogPanel projectId={projectId} />}
      </div>
    </aside>
  )
}
