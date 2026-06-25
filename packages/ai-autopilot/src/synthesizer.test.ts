import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, agent, getMessageText } from '@gemstack/ai-sdk'
import { defaultSynthesize, agentSynthesizer } from './synthesizer.js'
import type { SubtaskResult } from './types.js'

function result(id: string, description: string, text: string, ok = true): SubtaskResult {
  return {
    subtask: { id, description },
    text,
    ok,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

describe('defaultSynthesize', () => {
  it('concatenates successful results and omits failures', () => {
    const out = defaultSynthesize('t', [
      result('1', 'a', 'alpha'),
      result('2', 'b', '', false),
      result('3', 'c', 'gamma'),
    ])
    assert.equal(out, 'alpha\n\ngamma')
  })

  it('returns empty string when nothing succeeded', () => {
    assert.equal(defaultSynthesize('t', [result('1', 'a', '', false)]), '')
  })
})

describe('agentSynthesizer', () => {
  it('prompts the agent with the task + successful results and returns its text', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWith('final synthesized answer')
      const synth = agentSynthesizer(agent('You synthesize.'))
      const out = await synth('the task', [
        result('1', 'research', 'found X'),
        result('2', 'failed', '', false),
      ])
      assert.equal(out, 'final synthesized answer')

      const call = fake.getCalls()[0]!
      const text = call.messages.map(m => getMessageText(m.content)).join('\n')
      assert.match(text, /the task/)
      assert.match(text, /found X/)
      assert.ok(!text.includes('failed'), 'failed subtasks are not sent to the synthesizer')
    } finally {
      fake.restore()
    }
  })
})
