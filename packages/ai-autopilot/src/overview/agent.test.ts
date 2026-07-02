import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, agent } from '@gemstack/ai-sdk'
import { agentOverview, overviewLoopPrompt } from './agent.js'
import { CodeOverviewMaintainer } from './maintainer.js'
import { Loop } from '../loop/loop.js'
import { defineRule } from '../loop/define.js'
import type { CodeOverview } from './types.js'

describe('agentOverview (default regenerate over an ai-sdk agent)', () => {
  it('parses a structured overview and seeds the previous one', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([
        { text: JSON.stringify({ summary: 'A Vike shop', sections: [{ title: 'Structure', body: 'pages/, database/' }] }) },
      ])
      const previous: CodeOverview = { summary: 'old', sections: [] }
      const overview = await agentOverview(agent({ instructions: 'mapper' }))({ reason: 'restructure', previous })

      assert.equal(overview.summary, 'A Vike shop')
      assert.equal(overview.sections[0]?.title, 'Structure')
      // the previous overview reached the model so it revises rather than rewrites
      const sent = JSON.stringify(fake.getCalls()[0])
      assert.match(sent, /old/)
      assert.match(sent, /restructure/)
    } finally {
      fake.restore()
    }
  })
})

describe('overviewLoopPrompt (wire the maintainer into the loop)', () => {
  it('refreshes on a material loop event and reports it', async () => {
    let regenerated = 0
    const maintainer = new CodeOverviewMaintainer({
      regenerate: () => { regenerated++; return { summary: 'fresh', sections: [] } },
    })
    const loop = new Loop({
      rules: [defineRule({ on: 'major-change', run: ['code-overview'] })],
      prompts: [overviewLoopPrompt(maintainer)],
    })
    const result = await loop.handle({ kind: 'major-change', summary: 'switched build tool', paths: ['vite.config.ts'] })

    assert.equal(regenerated, 1)
    assert.match(result.outcomes[0]?.passes[0]?.text ?? '', /Refreshed CODE-OVERVIEW\.md/)
    assert.equal(maintainer.get()?.summary, 'fresh')
  })

  it('leaves the overview alone on an immaterial event', async () => {
    let regenerated = 0
    const maintainer = new CodeOverviewMaintainer({
      overview: { summary: 'kept', sections: [] },
      regenerate: () => { regenerated++; return { summary: 'nope', sections: [] } },
    })
    const loop = new Loop({
      rules: [defineRule({ on: 'major-change', run: ['code-overview'] })],
      prompts: [overviewLoopPrompt(maintainer)],
    })
    const result = await loop.handle({ kind: 'major-change', summary: 'tweak copy', paths: ['pages/about.tsx'] })

    assert.equal(regenerated, 0)
    assert.match(result.outcomes[0]?.passes[0]?.text ?? '', /unchanged/)
    assert.equal(maintainer.get()?.summary, 'kept')
  })
})
