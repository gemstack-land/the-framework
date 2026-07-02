import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, agent } from '@gemstack/ai-sdk'
import { agentDeploy, planOnlyTarget, FakeDeployTarget, DEFAULT_DEPLOY_TARGETS } from './deploy.js'
import type { DeployContext } from './types.js'

const ctx = (over: Partial<DeployContext> = {}): DeployContext => ({
  plan: { stack: 'Vike + universal-orm', narration: '', decisions: [] },
  scope: 'full',
  intent: 'a shop',
  productionGrade: true,
  ...over,
})

describe('planOnlyTarget (v1 default seam)', () => {
  it('decides + narrates only — never reports a deploy', async () => {
    const target = planOnlyTarget()
    const result = await target.deploy({ plan: { render: 'ssr', target: 'dockploy', reason: 'x' }, intent: 'a shop' })
    assert.equal(result.deployed, false)
    assert.match(result.detail ?? '', /infra-gated/)
  })
})

describe('FakeDeployTarget', () => {
  it('records the plans it received and returns a canned result', () => {
    const target = new FakeDeployTarget({ result: { deployed: true, url: 'https://x.example' } })
    const plan = { render: 'ssg' as const, target: 'cloudflare', reason: 'static' }
    const result = target.deploy({ plan, intent: 'a shop' })
    assert.equal(result.url, 'https://x.example')
    assert.deepEqual(target.deployed, [plan])
  })
})

describe('agentDeploy (default step over an ai-sdk agent)', () => {
  it('decides { render, target, reason } and hands the plan to the target', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([
        { text: JSON.stringify({ render: 'ssr', target: 'dockploy', reason: 'auth + per-request data' }) },
      ])
      const target = new FakeDeployTarget()
      const step = agentDeploy(agent({ instructions: 'deployer' }), { target })
      const outcome = await step(ctx())

      assert.deepEqual(outcome.plan, { render: 'ssr', target: 'dockploy', reason: 'auth + per-request data' })
      assert.equal(outcome.result.deployed, true)
      assert.equal(target.deployed.length, 1) // the plan reached the target
    } finally {
      fake.restore()
    }
  })

  it('defaults to a plan-only target when none is wired (v1 decides, does not ship)', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([{ text: JSON.stringify({ render: 'ssg', target: 'cloudflare', reason: 'static' }) }])
      const outcome = await agentDeploy(agent({ instructions: 'deployer' }))(ctx())
      assert.equal(outcome.plan.target, 'cloudflare')
      assert.equal(outcome.result.deployed, false)
    } finally {
      fake.restore()
    }
  })

  it('normalizes an out-of-set target to the first allowed one', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([{ text: JSON.stringify({ render: 'ssr', target: 'heroku', reason: 'habit' }) }])
      const outcome = await agentDeploy(agent({ instructions: 'deployer' }))(ctx())
      assert.equal(outcome.plan.target, DEFAULT_DEPLOY_TARGETS[0]) // 'heroku' is not allowed → 'dockploy'
    } finally {
      fake.restore()
    }
  })

  it('steers the decision with a custom target list', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([{ text: JSON.stringify({ render: 'spa', target: 'fly', reason: 'edge' }) }])
      const outcome = await agentDeploy(agent({ instructions: 'deployer' }), { targets: ['fly', 'render'] })(ctx())
      assert.equal(outcome.plan.target, 'fly')
      // the allowed targets reached the model
      const sent = JSON.stringify(fake.getCalls()[0])
      assert.match(sent, /fly/)
    } finally {
      fake.restore()
    }
  })
})
