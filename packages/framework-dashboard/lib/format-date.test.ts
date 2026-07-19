import { describe, expect, test } from 'vitest'
import { formatDate, formatDateTime } from './format-date.js'

describe('format-date (#759)', () => {
  test('formats a real timestamp', () => {
    const at = '2026-07-19T14:55:16.905Z'
    expect(formatDateTime(at)).toBe(new Date(at).toLocaleString())
    expect(formatDate(at)).toBe(new Date(at).toLocaleDateString())
  })

  test('an absent timestamp reads as the fallback, never "Invalid Date"', () => {
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDateTime('')).toBe('—')
  })

  test('an unparseable timestamp reads as the fallback too', () => {
    // A LOGS.md heading carries its `at` verbatim, so a hand-edited one lands here as-is.
    expect(formatDateTime('not a date')).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })

  test('the caller can word the fallback', () => {
    expect(formatDateTime(undefined, 'no activity yet')).toBe('no activity yet')
    expect(formatDateTime('nonsense', 'no activity yet')).toBe('no activity yet')
  })
})
