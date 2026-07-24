import { useEffect, useRef, useState } from 'react'
import type { AgentView } from '../lib/live-state.js'
import { Markdown } from './Markdown.js'
import { cn } from '../lib/utils.js'
import { ScrollArea } from './ui/scroll-area.js'
import { CopyButton } from './ui/copy-button.js'

// The agent-views rail (#441, part of #314): the ad-hoc markdown the agent pushed to the
// side panel via showMarkdown() (a plan, a summary, a writeup), each a first-class view
// with a sticky top-nav to jump between them. Unlike the choice gates it never blocks the
// run; views arrive over the live event stream and update in place when re-shown. A newly
// pushed view selects itself (#948) — the rail's tab badge only counts, so view 3 landing
// while you read view 0 used to be invisible. A view is also copy-bait (it is the plan or
// summary you paste elsewhere), so it gets a copy button.
export function ViewsRail({ views }: { views: AgentView[] }) {
  const [active, setActive] = useState(0)

  // Jump to a view we have not seen before; re-shown views update in place without stealing
  // the selection.
  const known = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = views.findIndex(v => !known.current.has(v.id))
    for (const v of views) known.current.add(v.id)
    if (fresh >= 0) setActive(fresh)
  }, [views])

  // A view can vanish (a new run truncates the stream); keep the selection in range.
  const current = views[Math.min(active, views.length - 1)]

  const scroller = useRef<HTMLDivElement>(null)
  if (!current) return <p className="p-4 text-sm text-muted-foreground">No views yet.</p>

  return (
    <div className="flex min-h-0 flex-auto flex-col">
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
      <ScrollArea viewportRef={scroller} className="min-h-0 flex-auto">
        <div className="p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            {current.title}
            <CopyButton text={current.markdown} label="Copy this view as markdown" />
          </h2>
          <Markdown text={current.markdown} />
        </div>
      </ScrollArea>
    </div>
  )
}
