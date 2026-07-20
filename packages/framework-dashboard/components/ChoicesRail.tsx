import { useRef } from 'react'
import type { ChoiceRequest } from '@gemstack/framework'
import { ChoicePanel } from './ChoicePanel.js'
import { ScrollArea } from './ui/scroll-area.js'

// The choice-gates rail (#440, part of #314): every gate the run is currently parked on,
// shown at once in the right rail as a long scroll instead of one inline gate. A sticky
// top-nav jumps between the sets; the first (topmost) gate is `active`, so Ctrl+Enter
// accepts it unambiguously. Gates clear themselves as their `choice-resolved` events stream
// in (pendingChoices drops them); an empty list means there is nothing to decide right now.
export function ChoicesRail({
  projectId,
  runId,
  choices,
}: {
  projectId: string
  /** Which run the picks resolve (#749), forwarded to each panel. */
  runId?: string | null | undefined
  choices: ChoiceRequest[]
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const panels = useRef(new Map<string, HTMLDivElement>())

  if (choices.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No choices to make right now.</p>
  }

  const jump = (id: string) => panels.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {choices.length > 1 && (
        <nav className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-background/95 p-2 backdrop-blur">
          {choices.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => jump(c.id)}
              title={c.title}
              className="max-w-[10rem] truncate rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {i + 1}. {c.title}
            </button>
          ))}
        </nav>
      )}
      <ScrollArea viewportRef={scroller} className="min-h-0 flex-1">
        {choices.map((c, i) => (
          <div
            key={c.id}
            ref={el => {
              if (el) panels.current.set(c.id, el)
              else panels.current.delete(c.id)
            }}
          >
            <ChoicePanel projectId={projectId} runId={runId} choice={c} active={i === 0} />
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}
