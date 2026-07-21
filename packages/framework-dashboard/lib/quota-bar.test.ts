import { describe, expect, test } from 'vitest'
import { weekTicks, quotaTone } from './quota-bar.js'

// The bar's arithmetic. The default formatter is pinned to en-US on purpose (a localized short
// weekday sliced to two characters is not distinguishing in every locale), so these assertions
// hold on any machine and the last case here proves it rather than assuming it.
const weekday = (at: number) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(at).getDay()]!

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

describe('weekTicks', () => {
  test('a week starting mid-day labels its start day at both ends (#960)', () => {
    // Tuesday evening, local time, which is the case the issue draws: TU WE TH FR SA SU MO TU.
    const startsAt = new Date(2026, 6, 21, 19, 0, 0).getTime() // Tue 21 Jul 2026, 19:00 local
    const ticks = weekTicks(startsAt, startsAt + WEEK_MS, weekday)
    expect(ticks.map(t => t.label)).toEqual(['TU', 'WE', 'TH', 'FR', 'SA', 'SU', 'MO', 'TU'])
    // The first is the start of the bar, not a midnight, and the rest climb toward the reset.
    expect(ticks[0]).toMatchObject({ percent: 0, start: true })
    expect(ticks[1]!.percent).toBeGreaterThan(0)
    expect(ticks.at(-1)!.percent).toBeLessThan(100)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.percent).toBeGreaterThan(ticks[i - 1]!.percent)
  })

  test('a week starting exactly at midnight does not repeat its first day', () => {
    const startsAt = new Date(2026, 6, 21, 0, 0, 0).getTime()
    const ticks = weekTicks(startsAt, startsAt + WEEK_MS, weekday)
    // The start is already a midnight, so the following midnights are WE..MO and the reset falls
    // on the next TU midnight, which is the end of the bar rather than a label inside it.
    expect(ticks.map(t => t.label)).toEqual(['TU', 'WE', 'TH', 'FR', 'SA', 'SU', 'MO'])
  })

  test('an empty or inverted span draws nothing rather than dividing by zero', () => {
    expect(weekTicks(1000, 1000, weekday)).toEqual([])
    expect(weekTicks(2000, 1000, weekday)).toEqual([])
  })
})

describe('quotaTone', () => {
  // The band exists so an account spending exactly as intended does not flip colour every day at
  // the moment the boundary steps a seventh.
  test('reads consumption against the boundary, with a band around it', () => {
    expect(quotaTone(10, 43)).toBe('under')
    expect(quotaTone(41, 43)).toBe('near')
    expect(quotaTone(46, 43)).toBe('near')
    expect(quotaTone(60, 43)).toBe('over')
    expect(quotaTone(100, 43)).toBe('full')
  })

  test('a spent week is full even when the boundary has caught up to it', () => {
    // Day seven allows the whole allowance, so "over" would be wrong here: nothing is left, which
    // is a different thing from spending too fast.
    expect(quotaTone(100, 100)).toBe('full')
    expect(quotaTone(99, 100)).toBe('near')
  })
})

test('the built-in labels are a fixed two-letter notation, not the machine locale', () => {
  // On a he-IL machine every short weekday begins `יו`, so a localized axis would label all seven
  // days the same. The default formatter has to be locale-independent for the axis to mean anything.
  const startsAt = new Date(2026, 6, 21, 19, 0, 0).getTime()
  const labels = weekTicks(startsAt, startsAt + WEEK_MS).map(t => t.label)
  expect(labels).toEqual(['TU', 'WE', 'TH', 'FR', 'SA', 'SU', 'MO', 'TU'])
})

