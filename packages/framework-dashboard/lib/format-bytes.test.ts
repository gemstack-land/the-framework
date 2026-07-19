import { describe, expect, test } from 'vitest'
import { formatBytes } from './format-bytes.js'

describe('formatBytes (#798)', () => {
  test('scales to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB')
    expect(formatBytes(3 * 1024 ** 4)).toBe('3 TB')
  })

  test('a size that could not be read falls back rather than printing a zero', () => {
    // `du` is best-effort (missing on Windows, refused on an unreadable dir); a "0 B" worktree
    // would read as an answer.
    expect(formatBytes(undefined)).toBe('–')
    expect(formatBytes(Number.NaN)).toBe('–')
    expect(formatBytes(-1)).toBe('–')
    expect(formatBytes(undefined, '')).toBe('')
  })
})
