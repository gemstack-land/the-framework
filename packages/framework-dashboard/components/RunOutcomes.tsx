import type { RunStatus } from '@gemstack/framework'

// How past runs ended (#471). These are the reserved status colours (good / warning /
// critical), so every segment ships with a written label and count — identity is never
// carried by colour alone. Zero-count outcomes are dropped from the bar but still listed.
const OUTCOMES: { key: Exclude<RunStatus, 'running'>; label: string; fill: string; dot: string }[] = [
  { key: 'done', label: 'Done', fill: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'failed', label: 'Failed', fill: 'bg-red-500', dot: 'bg-red-500' },
  { key: 'stopped', label: 'Stopped', fill: 'bg-amber-500', dot: 'bg-amber-500' },
]

export function RunOutcomes({ counts }: { counts: Record<RunStatus, number> }) {
  const total = OUTCOMES.reduce((sum, o) => sum + counts[o.key], 0)

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No finished runs yet.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {OUTCOMES.filter(o => counts[o.key] > 0).map(o => (
          <div
            key={o.key}
            className={`${o.fill} rounded-full`}
            style={{ width: `${(counts[o.key] / total) * 100}%` }}
            title={`${o.label}: ${counts[o.key]}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {OUTCOMES.map(o => (
          <li key={o.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${o.dot}`} aria-hidden />
            <span className="text-muted-foreground">{o.label}</span>
            <span className="font-medium tabular-nums">{counts[o.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
