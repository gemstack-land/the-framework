import { describe, expect, test } from 'vitest'
import type { Intervention } from '@gemstack/framework'
import { interventionKey, pickNewInterventions } from './interventions.js'

const item = (number: number, url: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'pr', number, title: `pr ${number}`, url })

describe('interventions helpers (#627)', () => {
  test('interventionKey is the PR url', () => {
    expect(interventionKey(item(7, 'https://gh/pr/7'))).toBe('https://gh/pr/7')
  })

  test('pickNewInterventions returns only items whose key is not already seen', () => {
    const current = [item(7, 'https://gh/pr/7'), item(8, 'https://gh/pr/8')]
    expect(pickNewInterventions(new Set(['https://gh/pr/7']), current).map(i => i.number)).toEqual([8])
    // Nothing new when every current item is already seen.
    expect(pickNewInterventions(new Set(['https://gh/pr/7', 'https://gh/pr/8']), current)).toEqual([])
  })
})
