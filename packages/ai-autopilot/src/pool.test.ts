import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runPool } from './pool.js'

const tick = () => new Promise<void>(r => setTimeout(r, 1))

describe('runPool', () => {
  it('runs every item and preserves input order in results', async () => {
    const { results, stopped } = await runPool([1, 2, 3, 4], 2, async (n) => {
      await tick()
      return n * 10
    })
    assert.deepEqual(results, [10, 20, 30, 40])
    assert.equal(stopped, false)
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick()
      inFlight--
      return n
    })
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`)
  })

  it('stops claiming new items once shouldStop flips, and reports stopped', async () => {
    let done = 0
    const { results, stopped } = await runPool([1, 2, 3, 4, 5], 1, async (n) => {
      done++
      return n
    }, () => done >= 2)
    assert.equal(stopped, true)
    assert.equal(results.length, 2)        // only the first two ran
    assert.deepEqual(results, [1, 2])
  })

  it('handles an empty list', async () => {
    const { results, stopped } = await runPool([], 4, async () => 1)
    assert.deepEqual(results, [])
    assert.equal(stopped, false)
  })
})
