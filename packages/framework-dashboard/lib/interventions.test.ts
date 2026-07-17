import { describe, expect, test } from 'vitest'
import type { Intervention } from '@gemstack/framework'
import { interventionKey, pickNewInterventions } from './interventions.js'

const item = (number: number, url: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'pr', number, title: `pr ${number}`, url })
const awaiting = (projectId: string, awaitId: string): Intervention => ({ projectId, projectName: projectId, kind: 'awaiting', title: 'q?', url: '', awaitId })

describe('interventions helpers (#627)', () => {
  test('interventionKey is the PR url', () => {
    expect(interventionKey(item(7, 'https://gh/pr/7'))).toBe('https://gh/pr/7')
  })

  test('interventionKey is project+gate for an awaiting run, so it survives an empty/shared url (#636)', () => {
    expect(interventionKey(awaiting('a', 'g1'))).toBe('awaiting:a:g1')
    // Two projects paused on same-id gates stay distinct despite an identical (empty) url.
    expect(interventionKey(awaiting('a', 'g1'))).not.toBe(interventionKey(awaiting('b', 'g1')))
  })

  test('pickNewInterventions returns only items whose key is not already seen', () => {
    const current = [item(7, 'https://gh/pr/7'), item(8, 'https://gh/pr/8')]
    expect(pickNewInterventions(new Set(['https://gh/pr/7']), current).map(i => i.number)).toEqual([8])
    // Nothing new when every current item is already seen.
    expect(pickNewInterventions(new Set(['https://gh/pr/7', 'https://gh/pr/8']), current)).toEqual([])
  })
})
