import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { UsageMeter } from './usage.js'

const turn = { costUsd: 0.02, inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 50 }

test('UsageMeter starts at zero', () => {
  assert.deepEqual(new UsageMeter().totals(), {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
  })
})

test('UsageMeter sums each field and counts turns (#322)', () => {
  const m = new UsageMeter()
  m.add(turn)
  m.add(turn)
  assert.deepEqual(m.totals(), {
    costUsd: 0.04,
    inputTokens: 200,
    outputTokens: 80,
    cacheReadTokens: 1800,
    cacheCreationTokens: 100,
    turns: 2,
  })
})

test('UsageMeter.totals returns a snapshot, not the live state', () => {
  const m = new UsageMeter()
  m.add(turn)
  const snap = m.totals()
  m.add(turn)
  assert.equal(snap.turns, 1)
  assert.equal(m.totals().turns, 2)
})
