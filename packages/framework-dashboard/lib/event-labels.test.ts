import { describe, expect, it } from 'vitest'
import { eventKindLabel } from './event-labels.js'

describe('eventKindLabel', () => {
  it('renames the jargon kinds to plain words', () => {
    expect(eventKindLabel('driver')).toBe('agent')
    expect(eventKindLabel('settled')).toBe('waiting')
    expect(eventKindLabel('usage')).toBe('cost')
    expect(eventKindLabel('session-update')).toBe('resume')
  })

  it('de-hyphenates the kinds that are already clear', () => {
    expect(eventKindLabel('system-prompt')).toBe('system prompt')
    expect(eventKindLabel('ready-for-merge')).toBe('ready for merge')
  })

  it('leaves a plain single-word kind untouched', () => {
    expect(eventKindLabel('session')).toBe('session')
    expect(eventKindLabel('log')).toBe('log')
  })
})
