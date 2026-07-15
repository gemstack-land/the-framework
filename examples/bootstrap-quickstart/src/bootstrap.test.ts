import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runCapstone, INTENT } from './bootstrap.js'

describe('bootstrap capstone: the whole epic composes end-to-end (offline)', () => {
  it('detects the preset, runs scope → build → loop → deploy, and maps the code', async () => {
    const lines: string[] = []
    const { detection, result, events, files, overview } = await runCapstone(line => lines.push(line))

    // Preset: the Vike framework was detected from the project deps.
    assert.equal(detection.preset?.name, 'vike')
    assert.equal(detection.framework, 'Vike')

    // Build: each worker wrote its file into the sandbox.
    assert.ok('database/schema.ts' in files)
    assert.ok('pages/orders/+Page.jsx' in files)
    assert.ok('pages/orders/+config.js' in files)
    assert.ok('package.json' in files) // the seed survived
    assert.equal(result.run.results.length, 3)
    assert.ok(result.run.results.every(r => r.ok))

    // Full-fledged loop: blocked on pass 1, clean on pass 2 → production-grade.
    assert.equal(result.passes, 2)
    assert.deepEqual(result.blockers, [])
    assert.equal(result.productionGrade, true)

    // Deploy: decided SSR → Cloudflare and shipped via the real cloudflareTarget
    // adapter (over a simulated wrangler), reporting the live URL it printed.
    assert.equal(result.deploy?.plan.render, 'ssr')
    assert.equal(result.deploy?.plan.target, 'cloudflare')
    assert.equal(result.deploy?.result.deployed, true)
    assert.equal(result.deploy?.result.url, 'https://orders-app.gemstack.workers.dev')

    // Surface: the stream ran scope-first, done-last, and the terminal printed it.
    assert.equal(events[0]?.type, 'scope')
    assert.equal(events.at(-1)?.type, 'done')
    assert.ok(lines.some(l => l.includes('scope:')))
    assert.ok(lines.some(l => l.includes('deploy:')))

    // Scale mode: an overview was generated from the scaffold.
    assert.match(overview?.summary ?? '', /orders app/)
    assert.ok((overview?.sections.length ?? 0) >= 1)
  })

  it('exposes the intent constant for the runnable demo', () => {
    assert.match(INTENT, /Orders page/)
  })
})
