import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Agent } from '@gemstack/ai-sdk'
import type { AgentResponse, TokenUsage } from '@gemstack/ai-sdk'
import { promptInstructions, renderTask, toLoopPrompt, loopPromptsFor, type PromptAgentContext } from './bridge.js'
import { PromptLibrary } from './library.js'
import type { Prompt } from './types.js'
import { LoopEngine } from '../loop/loop.js'
import { defineLoop } from '../loop/define.js'
import { DecisionLedger } from '../decisions/ledger.js'

const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

/** An agent whose prompt() echoes its instructions + the task it received. */
class EchoAgent extends Agent {
  constructor(private readonly note: string) {
    super()
  }
  instructions(): string {
    return this.note
  }
  override async prompt(input: string): Promise<AgentResponse> {
    return { text: `[${this.note}] ${input}`, steps: [], usage, finishReason: 'stop' }
  }
}

const prompt = (over: Partial<Prompt> = {}): Prompt => ({
  id: 'review', name: 'review', title: 'Review', description: '', instructions: 'REVIEW BODY', passes: 1, appliesTo: [], ...over,
})

describe('promptInstructions', () => {
  it('prepends the decisions briefing when the ledger has rejections', () => {
    const ledger = new DecisionLedger()
    ledger.reject('Use Redux', 'boilerplate')
    const composed = promptInstructions(prompt(), { ledger })
    assert.match(composed, /already considered and rejected/)
    assert.match(composed, /REVIEW BODY$/)
  })

  it('is just the body with no ledger or nothing rejected', () => {
    assert.equal(promptInstructions(prompt()), 'REVIEW BODY')
    assert.equal(promptInstructions(prompt(), { ledger: new DecisionLedger() }), 'REVIEW BODY')
  })
})

describe('renderTask', () => {
  it('renders kind, summary, and file list', () => {
    const t = renderTask({ kind: 'major-change', summary: 'reworked auth', paths: ['src/auth.ts'] })
    assert.match(t, /Change kind: major-change/)
    assert.match(t, /Summary: reworked auth/)
    assert.match(t, /- src\/auth\.ts/)
  })
})

describe('toLoopPrompt', () => {
  it('builds a fresh agent per pass and prompts it with the rendered task', async () => {
    const seen: PromptAgentContext[] = []
    const lp = toLoopPrompt(prompt({ passes: 3 }), ctx => {
      seen.push(ctx)
      return new EchoAgent(`p${ctx.pass}`)
    })
    assert.equal(lp.passes, 3)
    const loop = new LoopEngine({ loops: [defineLoop({ on: 'major-change', run: ['review'] })], prompts: [lp] })
    const result = await loop.handle({ kind: 'major-change', summary: 's' })

    assert.equal(seen.length, 3) // one fresh agent per pass
    assert.deepEqual(seen.map(c => c.pass), [1, 2, 3])
    assert.match(seen[0]!.instructions, /REVIEW BODY/)
    assert.match(result.outcomes[0]!.passes[0]!.text, /\[p1\] Change kind: major-change/)
  })
})

describe('loopPromptsFor', () => {
  it('materializes a library so default-policy ids resolve', async () => {
    const library = new PromptLibrary([
      prompt({ id: 'review' }),
      prompt({ id: 'security', name: 'security', instructions: 'SEC' }),
    ])
    const loop = new LoopEngine({
      loops: [defineLoop({ on: 'major-change', run: ['review', 'security'] })],
      prompts: loopPromptsFor(library, ctx => new EchoAgent(ctx.prompt.id)),
    })
    const result = await loop.handle({ kind: 'major-change' })
    assert.deepEqual(result.outcomes.map(o => o.promptId), ['review', 'security'])
    assert.ok(result.outcomes.every(o => o.ok))
  })
})
