import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { mergeUsage } from './agent.js'

// `mergeUsage` is the agent loop's defense against providers emitting usage
// across multiple chunks within a step. The canonical failure case is
// Anthropic / Bedrock-Anthropic streams: `message_start` carries the prompt
// count, `message_delta` carries the completion count, and a naive last-wins
// overwrite drops the prompt count from the final aggregate. MAX per field
// is safe because every chunk is a running snapshot (token counts only grow
// within a step).

describe('mergeUsage', () => {
  test('takes MAX per field across two snapshots', () => {
    const merged = mergeUsage(
      { promptTokens: 100, completionTokens: 0, totalTokens: 100 },
      { promptTokens: 0,   completionTokens: 42, totalTokens: 42  },
    )
    assert.deepEqual(merged, {
      promptTokens:     100,
      completionTokens: 42,
      totalTokens:      100,
    })
  })

  test('does not regress when the second snapshot is complete', () => {
    const merged = mergeUsage(
      { promptTokens: 100, completionTokens: 0,  totalTokens: 100 },
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    )
    assert.deepEqual(merged, {
      promptTokens:     100,
      completionTokens: 50,
      totalTokens:      150,
    })
  })

  test('regression: Anthropic-shaped chunk sequence preserves prompt count', () => {
    // Simulate the exact sequence the agent loop sees from Anthropic /
    // Bedrock-Anthropic streams: a `usage` chunk from message_start with the
    // prompt count, then a `finish` chunk from message_delta. Before the fix,
    // the finish chunk had promptTokens: 0, last-wins kept the zero, and
    // billing silently undercharged. After the fix, mergeUsage keeps the 100.

    const usageChunk:  { promptTokens: number; completionTokens: number; totalTokens: number } = { promptTokens: 100, completionTokens: 0,  totalTokens: 100 }
    // What a BROKEN provider would emit (kept here so the test documents the
    // exact failure mode and would catch a regression that re-introduces it).
    const brokenFinish: { promptTokens: number; completionTokens: number; totalTokens: number } = { promptTokens: 0,   completionTokens: 50, totalTokens: 50  }

    let stepUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    stepUsage = mergeUsage(stepUsage, usageChunk)
    stepUsage = mergeUsage(stepUsage, brokenFinish)

    assert.equal(stepUsage.promptTokens, 100, 'prompt count from earlier usage chunk must survive a broken finish chunk')
    assert.equal(stepUsage.completionTokens, 50)
    assert.equal(stepUsage.totalTokens, 100)
  })

  test('does not invent counts when both snapshots are zero', () => {
    const merged = mergeUsage(
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    )
    assert.deepEqual(merged, { promptTokens: 0, completionTokens: 0, totalTokens: 0 })
  })
})
