import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_INTENT, runDemo } from './demo.js'

describe('framework demo: one prompt → a running, deployed app (offline)', () => {
  it('runs the whole product flow and ends at a real serving app', async () => {
    const lines: string[] = []
    const out = await runDemo(line => lines.push(line))

    // Preset detection picked Vike from the demo's deps signals.
    assert.equal(out.framework, 'Vike')

    // The full-fledged loop blocked once (no auth) then cleared → production-grade.
    assert.equal(out.productionGrade, true)
    assert.equal(out.passes, 2)

    // Deploy ran the real cloudflareTarget adapter → a live workers.dev URL.
    assert.equal(out.deployTarget, 'cloudflare')
    assert.equal(out.deployUrl, 'https://orders-app.gemstack.workers.dev')

    // The app was actually booted and served (not just narrated).
    assert.match(out.previewUrl ?? '', /^http:\/\/localhost:\d+$/)
    assert.match(out.served, /Orders/)
    assert.match(out.served, /Ada Lovelace/)

    // The narration told the whole story: the prompt, then a production-grade end.
    assert.ok(lines.some(l => l.includes(DEMO_INTENT)))
    assert.ok(lines.some(l => l.includes('production-grade')))
    assert.ok(lines.some(l => l.includes('your app is running at')))
  })
})
