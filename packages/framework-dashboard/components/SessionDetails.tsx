import type { FrameworkEvent } from '@gemstack/the-framework'
import { AGENT_LABELS, agentForDriver, sessionInfo } from '@gemstack/the-framework/client'

// The session-details strip behind the action bar's disclosure (always available now, so the
// chevron no longer pops in and out with the git/handoff data). It shows the "about this run"
// facts the wrapped agent's own chat does not: which agent ran it, and what it has spent so far
// (folded from the #322 usage events). The git branch / PR / changes sit in the bar row right
// above this, so they are not repeated here.

type UsageEvent = Extract<FrameworkEvent, { kind: 'usage' }>

/** The latest cumulative usage event, or undefined before the agent reports any. */
function lastUsage(events: FrameworkEvent[]): UsageEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.kind === 'usage') return event
  }
  return undefined
}

/** Compact token counts: 1234 -> "1.2k", 1_200_000 -> "1.2M". */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  )
}

export function SessionDetails({ events }: { events: FrameworkEvent[] }) {
  const session = sessionInfo(events)
  const agent = agentForDriver(session?.driver)
  const agentLabel = agent ? AGENT_LABELS[agent] : (session?.driver ?? 'Agent')
  const usage = lastUsage(events)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs">
      <Fact label="Agent" value={agentLabel} />
      {usage ? (
        <>
          {usage.costUsd !== undefined && <Fact label="Spent" value={`$${usage.costUsd.toFixed(2)}`} />}
          <Fact label="Tokens" value={`${compact(usage.inputTokens)} in / ${compact(usage.outputTokens)} out`} />
          {(usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0) && (
            <Fact label="Cache" value={`${compact(usage.cacheReadTokens)} read / ${compact(usage.cacheCreationTokens)} write`} />
          )}
          <Fact label="Turns" value={String(usage.turns)} />
        </>
      ) : (
        <span className="text-muted-foreground/70">No spend reported yet</span>
      )}
    </div>
  )
}
