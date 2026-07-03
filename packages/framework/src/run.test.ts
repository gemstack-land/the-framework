import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runFramework } from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import type { FrameworkEvent } from './events.js'

test('runFramework drives the whole flow through the driver, offline, to production-grade', async () => {
  const events: FrameworkEvent[] = []
  const { result, detection } = await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    deploy: FAKE_DEPLOY,
    onEvent: e => events.push(e),
  })

  // Preset detection picked Vike from the deps.
  assert.equal(detection.framework, 'Vike')

  // The full-fledged loop blocked once (no auth) then cleared.
  assert.equal(result.productionGrade, true)
  assert.equal(result.passes, 2)
  assert.deepEqual(result.blockers, [])

  // The architect's choices were recorded and narrated.
  const architect = events.find(e => e.kind === 'bootstrap' && e.event.type === 'architect')
  assert.ok(architect)

  // The deploy phase decided SSR -> cloudflare.
  assert.equal(result.deploy?.plan.target, 'cloudflare')

  // We surfaced the wrapped agent's own progress and framed with personas.
  assert.ok(events.some(e => e.kind === 'driver'))
  assert.ok(events.some(e => e.kind === 'session' && e.fake === true))
  assert.equal(events.at(-1)!.kind, 'end')
})

test('runFramework prototype scope skips the full-fledged loop', async () => {
  const { result } = await runFramework({
    intent: 'a quick landing page',
    scope: 'prototype',
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
  })
  assert.equal(result.passes, 0)
  assert.equal(result.productionGrade, false)
})
