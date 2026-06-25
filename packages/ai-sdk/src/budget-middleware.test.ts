import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { type ModelPriceEntry } from './budget/pricing.js'
import { memoryBudgetStorage } from './budget/storage.js'
import {
  withBudget,
  type WithBudgetOptions,
} from './budget/with-budget.js'
import {
  BudgetExceededError,
  UnknownModelPricingError,
} from './budget/pricing.js'

// ─── Test fixtures ────────────────────────────────────────

// AiFake registers as '__fake__' provider with model '__fake__/default'.
// Use a pricing override for that key so tests don't depend on the real
// catalog and rates remain stable across catalog updates.
const TEST_RATE = { inputPer1k: 0.0008, outputPer1k: 0.004, _snapshotDate: '2026-05-11' as const }
const TEST_PRICING: Record<string, ModelPriceEntry> = {
  '__fake__/default': TEST_RATE,
}

class TestAgent extends Agent {
  instructions() { return 'You are a test agent.' }
}

function makeAgent(opts: Omit<WithBudgetOptions, 'storage' | 'pricing'> & {
  storage?: WithBudgetOptions['storage']
  pricing?: WithBudgetOptions['pricing']
}): Agent {
  const storage = opts.storage ?? memoryBudgetStorage()
  const pricing = opts.pricing ?? TEST_PRICING
  const mw = withBudget({ ...opts, storage, pricing })
  class A extends TestAgent {
    middleware() { return [mw] }
  }
  return new A()
}

// ─── Bypass + happy path ──────────────────────────────────

describe('withBudget — bypass paths', () => {
  let fake: AiFake
  beforeEach(() => {
    fake = AiFake.fake()
    fake.respondWith('ok')
  })
  afterEach(() => { fake.restore() })

  it('does nothing when user resolver returns null', async () => {
    const storage = memoryBudgetStorage()
    const agent = makeAgent({
      user:    () => null,
      budget:  () => ({ daily: 0.01 }),
      storage,
    })

    await agent.prompt('hello')

    // Storage was never touched — pure read shows zero.
    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.equal(peek.spent, 0)
  })

  it('does nothing when budget returns no caps', async () => {
    const storage = memoryBudgetStorage()
    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({}),  // neither daily nor monthly
      storage,
    })

    await agent.prompt('hello')

    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.equal(peek.spent, 0)
  })
})

// ─── Pre-debit path ───────────────────────────────────────

describe('withBudget — pre-debit', () => {
  let fake: AiFake
  beforeEach(() => {
    fake = AiFake.fake()
    fake.respondWith('ok')
  })
  afterEach(() => { fake.restore() })

  it('pre-debits estimated input cost before the model call', async () => {
    const storage = memoryBudgetStorage()
    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1.00 }),
      storage,
    })

    await agent.prompt('hello world')

    // System prompt ('You are a test agent.', 23 chars) + user message ('hello world', 11 chars).
    // No "\n" between because we join — but estimator sees the concat.
    // Total ~35 chars / 4 = 9 tokens × $0.0008 / 1k = ~$0.0000072 — small
    // but greater than zero. Just assert positive spend.
    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.ok(peek.spent > 0, `expected positive pre-debit, got ${peek.spent}`)
  })

  it('throws BudgetExceededError when cap would be exceeded; default error class carries userId/period/cap', async () => {
    const storage = memoryBudgetStorage()
    // Pre-fill the user's daily counter near the cap line so the next pre-debit overflows.
    await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.999999 })

    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1 }),
      storage,
    })

    await assert.rejects(
      () => agent.prompt('hello world'),
      (err: unknown) => {
        assert.ok(err instanceof BudgetExceededError, 'expected BudgetExceededError')
        assert.equal((err as BudgetExceededError).userId, 'u-1')
        assert.equal((err as BudgetExceededError).period, 'daily')
        assert.equal((err as BudgetExceededError).cap,    1)
        return true
      },
    )
  })

  it('honors custom onExceeded — caller can throw a different error class', async () => {
    class TooExpensiveError extends Error {}
    const storage = memoryBudgetStorage()
    await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.999999 })

    const agent = makeAgent({
      user:        () => 'u-1',
      budget:      () => ({ daily: 1 }),
      storage,
      onExceeded:  () => { throw new TooExpensiveError('over cap') },
    })

    await assert.rejects(() => agent.prompt('hello'), TooExpensiveError)
  })

  it('throws BudgetExceededError if onExceeded does not throw — debit must always abort the run', async () => {
    const storage = memoryBudgetStorage()
    await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.999999 })

    const agent = makeAgent({
      user:        () => 'u-1',
      budget:      () => ({ daily: 1 }),
      storage,
      // onExceeded that doesn't throw — middleware must still throw the default.
      onExceeded:  () => undefined as unknown as never,
    })

    await assert.rejects(() => agent.prompt('hello'), BudgetExceededError)
  })

  it('enforces daily AND monthly together — first denial wins', async () => {
    const storage = memoryBudgetStorage()
    // Daily under cap, monthly over cap.
    await storage.checkAndDebit({ userId: 'u-1', period: 'monthly', cap: 5, costUsd: 4.999999 })

    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1, monthly: 5 }),
      storage,
    })

    await assert.rejects(
      () => agent.prompt('hello'),
      (err: unknown) => {
        assert.ok(err instanceof BudgetExceededError)
        assert.equal((err as BudgetExceededError).period, 'monthly')
        return true
      },
    )
  })

  it('throws UnknownModelPricingError at iteration time when the model is not in the catalog', async () => {
    // Empty pricing map ⇒ even the fake's default model isn't priced.
    class UnknownModelAgent extends TestAgent {
      middleware() { return [withBudget({
        user:    () => 'u-1',
        budget:  () => ({ daily: 1 }),
        storage: memoryBudgetStorage(),
        pricing: {},
      })] }
    }

    await assert.rejects(() => new UnknownModelAgent().prompt('hello'), UnknownModelPricingError)
  })
})

// ─── Post-debit (true-up) path ────────────────────────────

describe('withBudget — post-debit true-up', () => {
  let fake: AiFake
  beforeEach(() => {
    fake = AiFake.fake()
  })
  afterEach(() => { fake.restore() })

  it('debits the actual cost difference once usage arrives', async () => {
    const storage = memoryBudgetStorage()
    // Deterministic usage: 10000 prompt tokens, 5000 completion tokens.
    // claude-haiku-4-5 = $0.0008/1k in, $0.004/1k out
    // Actual = (10000 × 0.0008 + 5000 × 0.004) / 1000 = 0.008 + 0.020 = 0.028
    fake.respondWithSequence([{
      text:  'response',
      usage: { promptTokens: 10000, completionTokens: 5000, totalTokens: 15000 },
    }])

    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1.00 }),
      storage,
    })

    await agent.prompt('a short prompt')

    // Final spent should equal actual cost (within float tolerance), NOT just the pre-debit.
    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.ok(Math.abs(peek.spent - 0.028) < 1e-9,
      `expected final spent ≈ 0.028 (actual cost), got ${peek.spent}`)
  })

  it('does not refund when actual usage came in below pre-debit estimate (small over-charge accepted)', async () => {
    const storage = memoryBudgetStorage()
    // 0 actual usage, but a long input message means the pre-debit > 0.
    // Final spent should be the pre-debit value, NOT zero — no refund.
    fake.respondWithSequence([{
      text:  'ok',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }])

    const longPrompt = 'word '.repeat(1000)  // 5000 chars → ~1250 tokens
    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1.00 }),
      storage,
    })

    await agent.prompt(longPrompt)

    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.ok(peek.spent > 0, 'expected pre-debit to remain on storage')
  })

  it('post-debit applies even when it pushes spend past the cap (response already streamed; cap bites on next request)', async () => {
    const storage = memoryBudgetStorage()
    // Pre-debit will pass for short prompt. Actual usage will be huge.
    fake.respondWithSequence([{
      text:  'expensive response',
      usage: { promptTokens: 1000000, completionTokens: 500000, totalTokens: 1500000 },
    }])

    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1.00 }),  // small cap
      storage,
    })

    await agent.prompt('hi')  // succeeds — pre-debit was tiny, response streams

    // Final spent now exceeds cap. Next request will be denied.
    const peekAfter = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.ok(peekAfter.spent > 1, `expected final spent > cap, got ${peekAfter.spent}`)

    // Verify the next pre-debit denies.
    fake.respondWithSequence([{ text: 'should not fire' }])
    await assert.rejects(() => agent.prompt('next'), BudgetExceededError)
  })
})

// ─── Pricing override path ────────────────────────────────

describe('withBudget — pricing override', () => {
  let fake: AiFake
  beforeEach(() => {
    fake = AiFake.fake()
    fake.respondWithSequence([{
      text:  'ok',
      usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
    }])
  })
  afterEach(() => { fake.restore() })

  it('uses the override pricing entry — spread {...defaultPricing, [model]: { ... }}', async () => {
    const storage = memoryBudgetStorage()
    // Cheap-mode override: 1/10 of TEST_RATE.
    const overridden: Record<string, ModelPriceEntry> = {
      '__fake__/default': {
        inputPer1k:    0.00008,
        outputPer1k:   0.0004,
        _snapshotDate: '2026-05-11',
      },
    }
    const agent = makeAgent({
      user:    () => 'u-1',
      budget:  () => ({ daily: 1.00 }),
      storage,
      pricing: overridden,
    })

    await agent.prompt('hello')

    // Actual @ overridden rate = (1000 × 0.00008 + 1000 × 0.0004) / 1000 = 0.00048
    // Actual @ TEST_RATE       = (1000 × 0.0008  + 1000 × 0.004 ) / 1000 = 0.0048
    // Override ⇒ 10× cheaper. Assert under TEST_RATE threshold to confirm override applied.
    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.ok(peek.spent < 0.001,
      `expected ~$0.00048 with override, got ${peek.spent} — pricing override was ignored`)
    assert.ok(peek.spent > 0.0001, `expected positive spend, got ${peek.spent}`)
  })
})

// ─── Multi-step (tool calling) ────────────────────────────

describe('withBudget — multi-step agent loops', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => { fake.restore() })

  it('pre-debits + true-ups for each iteration of a multi-step run', async () => {
    const storage = memoryBudgetStorage()
    fake.respondWithSequence([
      // Step 1: tool call. Step 2: final answer.
      {
        toolCalls: [{ id: 't1', name: 'noop', arguments: {} }],
        usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 },
      },
      {
        text:  'done',
        usage: { promptTokens: 2000, completionTokens: 500, totalTokens: 2500 },
      },
    ])

    const { toolDefinition } = await import('./tool.js')
    const { z } = await import('zod')
    const noop = toolDefinition({
      name: 'noop',
      description: 'no-op',
      inputSchema: z.object({}),
    }).server(async () => 'ok')

    class A extends TestAgent {
      tools() { return [noop] }
      middleware() { return [withBudget({
        user:    () => 'u-1',
        budget:  () => ({ daily: 1 }),
        storage,
        pricing: TEST_PRICING,
      })] }
    }

    await new A().prompt('do thing')

    // Total actual cost across both steps:
    // Step 1: (1000 × 0.0008 + 100 × 0.004) / 1000 = 0.0008 + 0.0004 = 0.0012
    // Step 2: (2000 × 0.0008 + 500 × 0.004) / 1000 = 0.0016 + 0.0020 = 0.0036
    // Sum: 0.0048
    const peek = await storage.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.ok(Math.abs(peek.spent - 0.0048) < 0.001,
      `expected final spent ≈ 0.0048 (sum of two steps), got ${peek.spent}`)
  })
})
