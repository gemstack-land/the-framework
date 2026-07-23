import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { UsageMeter } from './usage.js'

const turn = { costUsd: 0.02, inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 50 }

test('UsageMeter starts at zero, with no cost until one is reported (#540)', () => {
  const totals = new UsageMeter().totals()
  assert.deepEqual(totals, {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
  })
  // Absent, not 0: a `$0` total would read as "this run was free".
  assert.equal('costUsd' in totals, false)
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

test('UsageMeter counts tokens for an agent that reports no price (#540)', () => {
  // Codex's shape: real token counts, no costUsd.
  const m = new UsageMeter()
  m.add({ inputTokens: 186, outputTokens: 6, cacheReadTokens: 12032, cacheCreationTokens: 0 })
  m.add({ inputTokens: 186, outputTokens: 6, cacheReadTokens: 12032, cacheCreationTokens: 0 })
  const totals = m.totals()
  assert.equal(totals.turns, 2)
  assert.equal(totals.inputTokens, 372)
  assert.equal(totals.cacheReadTokens, 24064)
  // The tokens are real, so they total; the price was never reported, so it stays absent.
  assert.equal(totals.costUsd, undefined)
  assert.equal('costUsd' in totals, false)
})

test('UsageMeter totals a cost from the turns that had one (#540)', () => {
  // Mixed is not a real run today (one agent per run), but the total must still
  // mean "what we know was spent" rather than silently drop the priced turns.
  const m = new UsageMeter()
  m.add({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 })
  m.add(turn)
  assert.equal(m.totals().costUsd, 0.02)
  assert.equal(m.totals().turns, 2)
})

test('UsageMeter.totals returns a snapshot, not the live state', () => {
  const m = new UsageMeter()
  m.add(turn)
  const snap = m.totals()
  m.add(turn)
  assert.equal(snap.turns, 1)
  assert.equal(m.totals().turns, 2)
})
