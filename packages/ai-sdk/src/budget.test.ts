import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ModelPricing,
  estimateCost,
  assertKnownModelPricing,
  UnknownModelPricingError,
  BudgetExceededError,
  type ModelPriceEntry,
} from './budget/pricing.js'

// ─── Catalog hygiene ──────────────────────────────────────

describe('ModelPricing — catalog hygiene', () => {
  it('every entry has positive input + output rates and an ISO snapshot date', () => {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    for (const [model, entry] of Object.entries(ModelPricing)) {
      assert.ok(entry.inputPer1k  > 0,                 `${model}: inputPer1k > 0`)
      assert.ok(entry.outputPer1k > 0,                 `${model}: outputPer1k > 0`)
      assert.match(entry._snapshotDate, dateRe,        `${model}: _snapshotDate is YYYY-MM-DD`)
    }
  })

  it('cache rates, when present, are not higher than the input rate', () => {
    // Cache READS are always cheaper than fresh input. Cache WRITES on
    // Anthropic are at most ~1.25× input — still bounded.
    for (const [model, entry] of Object.entries(ModelPricing)) {
      if (entry.cacheReadPer1k != null) {
        assert.ok(entry.cacheReadPer1k <= entry.inputPer1k,
          `${model}: cacheReadPer1k (${entry.cacheReadPer1k}) should be <= inputPer1k (${entry.inputPer1k})`)
      }
      if (entry.cacheWritePer1k != null) {
        assert.ok(entry.cacheWritePer1k <= entry.inputPer1k * 1.5,
          `${model}: cacheWritePer1k (${entry.cacheWritePer1k}) should be <= 1.5× inputPer1k`)
      }
    }
  })

  it('covers the headline models for every shipped provider', () => {
    // Spot-check that the big-name models for each provider in
    // packages/ai/src/providers/ are priced. If a provider ships in main
    // but isn't represented here, the catalog is silently incomplete and
    // budget enforcement / eval cost columns produce $0 for users on
    // common configurations.
    const required = [
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-4-1',
      'openai/gpt-4o',
      'openai/o3',
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'bedrock/anthropic.claude-opus-4-7',
      'xai/grok-4',
      'deepseek/deepseek-chat',
      'mistral/mistral-large',
      'groq/llama-3.3-70b-versatile',
      'cohere/command-a',
    ]
    for (const model of required) {
      assert.ok(ModelPricing[model], `missing pricing for ${model}`)
    }
  })
})

// ─── estimateCost ─────────────────────────────────────────

describe('estimateCost', () => {
  it('returns 0 for unknown models — eval cost column should not crash on fresh model ids', () => {
    assert.equal(estimateCost('made-up/non-existent-model', 1000, 500), 0)
  })

  it('computes (prompt × inputPer1k + completion × outputPer1k) / 1000', () => {
    // Opus 4.7 is $0.015 / 1k input, $0.075 / 1k output
    // 2000 input + 500 output = 2 × 0.015 + 0.5 × 0.075 = 0.030 + 0.0375 = 0.0675
    const cost = estimateCost('anthropic/claude-opus-4-7', 2000, 500)
    assert.ok(Math.abs(cost - 0.0675) < 1e-9, `expected 0.0675, got ${cost}`)
  })

  it('honors an override pricing map', () => {
    const override: Record<string, ModelPriceEntry> = {
      'fake/model': { inputPer1k: 1, outputPer1k: 2, _snapshotDate: '2026-01-01' },
    }
    assert.equal(estimateCost('fake/model', 1000, 1000, override), 1 + 2)
    // And falls back to the override map's policy for unknowns (still 0)
    assert.equal(estimateCost('still-unknown', 1000, 1000, override), 0)
  })
})

// ─── assertKnownModelPricing ──────────────────────────────

describe('assertKnownModelPricing', () => {
  it('returns the entry for known models', () => {
    const entry = assertKnownModelPricing('anthropic/claude-opus-4-7')
    assert.equal(entry.inputPer1k, 0.015)
    assert.equal(entry.outputPer1k, 0.075)
  })

  it('throws UnknownModelPricingError with the model id and snapshot date for unknowns', () => {
    let err: unknown
    try { assertKnownModelPricing('made-up/unknown') }
    catch (e) { err = e }

    assert.ok(err instanceof UnknownModelPricingError)
    assert.equal((err as UnknownModelPricingError).model, 'made-up/unknown')
    assert.match((err as UnknownModelPricingError).message, /No pricing entry/)
    // The error message should include the catalog snapshot date so
    // users can tell whether the catalog is stale vs the id is wrong.
    assert.match((err as UnknownModelPricingError).message, /catalog snapshot \d{4}-\d{2}-\d{2}/)
  })

  it('honors an override pricing map', () => {
    const override: Record<string, ModelPriceEntry> = {
      'fake/model': { inputPer1k: 1, outputPer1k: 2, _snapshotDate: '2026-01-01' },
    }
    assert.equal(assertKnownModelPricing('fake/model', override).inputPer1k, 1)
    // anthropic/claude-opus-4-7 is in the default catalog, NOT the override.
    assert.throws(() => assertKnownModelPricing('anthropic/claude-opus-4-7', override), UnknownModelPricingError)
  })
})

// ─── BudgetExceededError ──────────────────────────────────

describe('BudgetExceededError', () => {
  it('carries userId, period, spent, cap and includes them in the message', () => {
    const err = new BudgetExceededError({ userId: 'u-1', period: 'daily', spent: 0.6234, cap: 0.50 })
    assert.equal(err.userId, 'u-1')
    assert.equal(err.period, 'daily')
    assert.equal(err.spent,  0.6234)
    assert.equal(err.cap,    0.50)
    assert.match(err.message, /daily/)
    assert.match(err.message, /u-1/)
    assert.match(err.message, /\$0\.50/)
    assert.match(err.message, /\$0\.6234/)
  })
})
