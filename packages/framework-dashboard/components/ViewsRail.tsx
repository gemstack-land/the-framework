import { useRef, useState } from 'react'
import type { AgentView } from '../lib/live-state.js'
import { Markdown } from './Markdown.js'
import { cn } from '../lib/utils.js'

// The agent-views rail (#441, part of #314): the ad-hoc markdown the agent pushed to the
// side panel via showMarkdown() (a plan, a summary, a writeup), each a first-class view
// with a sticky top-nav to jump between them. Unlike the choice gates it never blocks the
// run; views arrive over the live event stream and update in place when re-shown.
export function ViewsRail({ views }: { views: AgentView[] }) {
  const [active, setActive] = useState(0)

  // A view can vanish (a new run truncates the stream); keep the selection in range.
  const current = views[Math.min(active, views.length - 1)]

  const scroller = useRef<HTMLDivElement>(null)
  if (!current) return <p className="p-4 text-sm text-muted-foreground">No views yet.</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {views.length > 1 && (
        <nav className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-background/95 p-2 backdrop-blur">
          {views.map((v, i) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setActive(i)}
              title={v.title}
              className={cn(
                'max-w-[10rem] truncate rounded px-2 py-0.5 text-xs',
                i === active ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {v.title}
            </button>
          ))}
        </nav>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="mb-2 text-sm font-semibold">{current.title}</h2>
        <Markdown text={current.markdown} />
      </div>
    </div>
  )
}
