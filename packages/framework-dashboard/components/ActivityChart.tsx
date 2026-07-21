import { useState } from 'react'
import type { ActivityDay } from '@gemstack/framework'

/** The local calendar day as the chart's date keys are written (YYYY-MM-DD). */
function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Runs-per-day over the activity window (#471). A single-series magnitude-over-time chart,
// so: bars, one hue (the primary token), no legend, a hover read-out. Dependency-free — the
// bars are flex columns anchored to the baseline, each over a faint full-height track so a
// quiet day still reads as an empty slot rather than a gap. Hovering a column names its day.
// The columns are plain divs (#948): they act on nothing, so as buttons a keyboard user
// tabbed through 14 focusable controls that did nothing on Enter. The read-out data rides
// each column's title and the group's accessible description instead.
export function ActivityChart({ data }: { data: ActivityDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.count))
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const active = hover !== null ? data[hover] : null

  const runs = (n: number) => `${n} session${n === 1 ? '' : 's'}`
  // Say "today" only when the last column is actually today — a stale board must not claim it.
  const lastDate = data[data.length - 1]?.date
  const endLabel = lastDate === localDateKey(new Date()) ? 'today' : lastDate?.slice(5)

  return (
    <div>
      <div role="img" aria-label={`Session activity: ${runs(total)} in ${data.length} days`} className="flex h-32 items-end gap-[3px]">
        {data.map((d, i) => (
          <div
            key={d.date}
            title={`${d.date}: ${runs(d.count)}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="flex h-full flex-1 items-end rounded-sm bg-muted/40"
          >
            {d.count > 0 && (
              <div
                className={`w-full min-h-[3px] rounded-sm transition-colors ${hover === i ? 'bg-primary' : 'bg-primary/75'}`}
                style={{ height: `${(d.count / max) * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{data[0]?.date.slice(5)}</span>
        <span className="font-medium text-foreground">
          {active ? `${active.date.slice(5)} · ${runs(active.count)}` : `${runs(total)} in ${data.length} days`}
        </span>
        <span>{endLabel}</span>
      </div>
    </div>
  )
}
