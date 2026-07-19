import type { ConsumptionLimits, DriverQuotaWindow, LimitStatus, Preferences, QuotaView } from '@gemstack/framework'
import { DEFAULT_CONSUMPTION_LIMITS } from '@gemstack/framework/client'
import { useQuota } from '../lib/quota.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { cn } from '../lib/utils.js'

// The usage panel (#519): what the account has left, and how much of it The Framework may
// spend before it pauses itself. Two halves, because they answer different questions —
// "am I about to run out?" (the account's own windows) and "will my agents stop?" (the limits).

/** The three limits, in the order they bite: widest first. */
const LIMITS: { key: keyof ConsumptionLimits; label: string; hint: string }[] = [
  { key: 'daily', label: 'Daily', hint: 'How much of your week a single day may consume' },
  { key: 'fiveHour', label: 'Last 5h', hint: "How much of the day's budget a rolling 5 hours may consume" },
  { key: 'session', label: 'This session', hint: "How much of the day's budget one run may consume" },
]

function limitsOf(preferences: Preferences): ConsumptionLimits {
  // Absent means the defaults, not off: a user who never opened this is still guarded.
  return preferences.consumptionLimits ?? DEFAULT_CONSUMPTION_LIMITS
}

/** A bar, or an explicit "we don't know" — never an empty bar, which would read as "nothing used". */
function Meter({ percent, muted }: { percent: number | undefined; muted?: boolean }) {
  if (percent === undefined) return <div className="h-1.5 rounded-full bg-muted" />
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full transition-all', muted ? 'bg-muted-foreground/40' : 'bg-primary')}
        style={{ width: `${Math.max(percent, 1)}%` }}
      />
    </div>
  )
}

function AccountWindow({ window }: { window: DriverQuotaWindow }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{window.label}</span>
        <span className="text-xs text-muted-foreground">
          {window.percentUsed}% used{window.resetsAtText ? ` · resets ${window.resetsAtText}` : ''}
        </span>
      </div>
      <Meter percent={window.percentUsed} />
    </div>
  )
}

function LimitRow({
  label,
  hint,
  status,
  percent,
  onToggle,
}: {
  label: string
  hint: string
  status: LimitStatus
  percent: number
  onToggle: (enabled: boolean) => void
}) {
  return (
    <div className={cn('space-y-1', !status.enabled && 'opacity-50')}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <label className="flex cursor-pointer items-center gap-1.5" title={hint}>
          <input type="checkbox" checked={status.enabled} onChange={e => onToggle(e.target.checked)} />
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground">{percent}%</span>
        </label>
        <span className="text-xs text-muted-foreground">
          {status.usedPercent === undefined
            ? 'not measured yet'
            : `${Math.round(status.usedPercent)}% of its budget${status.reached ? ' · paused' : ''}`}
        </span>
      </div>
      <Meter percent={status.usedPercent} muted={!status.enabled} />
      {status.consumed !== undefined && !status.complete && status.enabled ? (
        // Say so rather than let a short window read as low usage.
        <p className="text-xs text-muted-foreground">Counting from when the dashboard started, so this covers less than the full window.</p>
      ) : null}
    </div>
  )
}

/** Why there's no reading, in words a user can act on. */
function unavailableNote(view: QuotaView): string | undefined {
  switch (view.unavailable) {
    case undefined:
      return undefined
    case 'no-subscription':
      return "This account has no subscription usage to report, so the limits don't apply."
    case 'agent-not-found':
      return 'Claude Code was not found, so usage cannot be read.'
    case 'unrecognized':
      return 'Claude Code reported its usage in a way this version does not recognize, so the limits are off.'
    default:
      return view.windows.length
        ? "Couldn't refresh just now, so these numbers may be a little behind."
        : 'Reading your usage now.'
  }
}

export function UsagePanel() {
  const view = useQuota()
  const preferences = usePreferences()
  const limits = limitsOf(preferences)

  const setLimit = (key: keyof ConsumptionLimits, enabled: boolean): void => {
    updatePreferences({ consumptionLimits: { ...limits, [key]: { ...limits[key], enabled } } })
  }

  const note = view ? unavailableNote(view) : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!view && <p className="text-sm text-muted-foreground">Reading your usage…</p>}

        {view?.windows.length ? (
          <div className="space-y-3">{view.windows.map(w => <AccountWindow key={w.label} window={w} />)}</div>
        ) : null}

        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

        {view ? (
          <div className="space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">Pause my agents once they have used this much:</p>
            {LIMITS.map(({ key, label, hint }) => (
              <LimitRow
                key={key}
                label={label}
                hint={hint}
                status={view.limits[key]}
                percent={limits[key].percent}
                onToggle={enabled => setLimit(key, enabled)}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
