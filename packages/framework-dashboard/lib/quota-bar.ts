// The usage bar's own arithmetic (#960), kept out of the component so it can be tested without a
// DOM and read without React. Everything here is about *drawing* the week; where the boundary sits
// and what it gates is the framework's (`quota-boundary.ts`), and this never re-derives it.

/** A weekday label and where it sits along the week, 0-100. */
export interface AxisTick {
  /** Position across the bar, 0 at the start of the quota week and 100 at its reset. */
  percent: number
  /** The day's two-letter name, e.g. `TU`. */
  label: string
  /** The first tick, which is the day the week began on rather than a midnight. */
  start?: boolean
}

/**
 * `TU` for a Tuesday, in the viewer's own zone.
 *
 * Deliberately not the viewer's locale. Two letters of a localized weekday is only distinguishing
 * in locales that happen to work like English: Hebrew's short weekdays are `יום א׳`..`יום ז׳`, so
 * slicing two characters labels all seven days identically. This axis is a fixed two-letter
 * notation, like a chart's, and the dates it stands for are spelled out in full elsewhere.
 */
function weekdayLabel(at: number): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(at).slice(0, 2).toUpperCase()
}

/**
 * The day labels across one quota week.
 *
 * The week starts whenever the account's does, which is generally mid-day, so the first label is
 * that day and the rest sit at each local midnight after it. That is why the start day appears
 * twice on a bar (once at the left edge, once again at its own midnight near the right): the week
 * is seven times twenty-four hours from an arbitrary moment, not seven calendar days.
 *
 * Midnight is re-derived each step rather than added as 24h, so a DST change does not slide every
 * later label by an hour.
 */
export function weekTicks(startsAt: number, resetsAt: number, weekday: (at: number) => string = weekdayLabel): AxisTick[] {
  const span = resetsAt - startsAt
  if (!(span > 0)) return []
  const ticks: AxisTick[] = [{ percent: 0, label: weekday(startsAt), start: true }]
  const cursor = new Date(startsAt)
  cursor.setHours(24, 0, 0, 0)
  // A week has at most eight labels; the bound is a guard against a pathological span, not a rule.
  while (cursor.getTime() < resetsAt && ticks.length < 9) {
    const at = cursor.getTime()
    ticks.push({ percent: ((at - startsAt) / span) * 100, label: weekday(at) })
    cursor.setHours(24, 0, 0, 0)
  }
  return ticks
}

/** How the week is going, which is the bar's colour. */
export type QuotaTone = 'under' | 'near' | 'over' | 'full'

/** Percentage points either side of the boundary that still count as "on track". */
const NEAR_BAND = 5

/**
 * Where consumption stands against the boundary.
 *
 * A band rather than a point, because the boundary moves a seventh of the week at a time: without
 * one the bar would flip from green to orange every day at the moment the boundary steps, on an
 * account that is spending exactly as intended.
 */
export function quotaTone(percentUsed: number, boundaryPercent: number, band = NEAR_BAND): QuotaTone {
  if (percentUsed >= 100) return 'full'
  if (percentUsed > boundaryPercent + band) return 'over'
  if (percentUsed >= boundaryPercent - band) return 'near'
  return 'under'
}

/** What each tone means, in the words the panel says out loud. */
export const TONE_NOTE: Record<QuotaTone, string> = {
  under: 'Under the line, with room to spend.',
  near: 'Tracking with the week.',
  over: 'Ahead of the week, so unattended work stands down until the line catches up.',
  full: 'The week is spent.',
}

/**
 * Where the automatic-consumption limit sits, given the boundary and the user's offset.
 *
 * The daemon computes this too, and its answer is the one that gates the work. This exists so the
 * panel can draw the line the instant the slider moves, rather than a poll later: the drawn line
 * would otherwise trail the control by up to thirty seconds, which reads as a broken slider.
 */
export function limitPercent(boundaryPercent: number, offset: number): number {
  return Math.min(Math.max(boundaryPercent + offset, 0), 100)
}

