import { useState } from 'react'
import type { ActivityDay } from '@gemstack/framework'

// Runs-per-day over the activity window (#471). A single-series magnitude-over-time chart,
// so: bars, one hue (the primary token), no legend, a hover read-out. Dependency-free — the
// bars are flex columns anchored to the baseline, each over a faint full-height track so a
// quiet day still reads as an empty slot rather than a gap. Hovering a column names its day.
export function ActivityChart({ data }: { data: ActivityDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.count))
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const active = hover !== null ? data[hover] : null

  const runs = (n: number) => `${n} run${n === 1 ? '' : 's'}`

  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]">
        {data.map((d, i) => (
          <button
            key={d.date}
            type="button"
            aria-label={`${d.date}: ${runs(d.count)}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="flex h-full flex-1 items-end rounded-sm bg-muted/40"
          >
            {d.count > 0 && (
              <div
                className={`w-full min-h-[3px] rounded-sm transition-colors ${hover === i ? 'bg-primary' : 'bg-primary/75'}`}
                style={{ height: `${(d.count / max) * 100}%` }}
              />
            )}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{data[0]?.date.slice(5)}</span>
        <span className="font-medium text-foreground">
          {active ? `${active.date.slice(5)} · ${runs(active.count)}` : `${runs(total)} in ${data.length} days`}
        </span>
        <span>today</span>
      </div>
    </div>
  )
}
