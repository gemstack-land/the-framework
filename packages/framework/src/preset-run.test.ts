import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { defineDomainPreset, defineLoop, defineSkill } from '@gemstack/ai-autopilot'
import { runFramework } from './run.js'
import { FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import type { Driver } from './driver/index.js'
import type { FrameworkEvent } from './events.js'

/** A driver that records the `system` framing it starts with, delegating the run to the fake. */
function recordingDriver(): { driver: Driver; system: () => string } {
  const fd = fakeDriver()
  let captured = ''
  const driver: Driver = {
    name: 'fake', // keep workspace-verify off (no fs in this unit test)
    start: opts => {
      captured = opts.system ?? ''
      return fd.start(opts)
    },
  }
  return { driver, system: () => captured }
}

const domainPreset = defineDomainPreset({
  name: 'software-development',
  title: 'Software Development',
  description: 'General engineering.',
  loops: [defineLoop({ on: 'major-change', run: ['code-review'] })],
  prompts: [{ id: 'code-review', name: 'code-review', title: 'Code review', description: '', instructions: 'Review the change for correctness.', passes: 1, appliesTo: [] }],
  skills: [defineSkill({ name: 'eng-practices', title: 'Engineering Practices', description: 'Code review guidelines.', url: 'https://google.github.io/eng-practices/' })],
})

test('a domain preset frames the run and is narrated', async () => {
  const events: FrameworkEvent[] = []
  const { driver, system } = recordingDriver()
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: domainPreset,
    modes: ['technical'],
    onEvent: e => events.push(e),
  })

  // The preset's skill framed the session system prompt.
  assert.match(system(), /Skill: Engineering Practices/)
  assert.match(system(), /google\.github\.io\/eng-practices/)

  // It was narrated (title + active modes).
  const log = events.find(e => e.kind === 'log' && /Domain preset: Software Development/.test(e.message))
  assert.ok(log, 'domain preset is logged')
  assert.match((log as { message: string }).message, /modes: technical/)

  // The run still completes normally.
  assert.equal(result.productionGrade, true)
})

test('the preset loop is materialized against the driver and runs its chain', async () => {
  const { driver } = recordingDriver()
  const { loop } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: domainPreset,
  })

  assert.ok(loop, 'result.loop is exposed when a preset is supplied')

  // Driving it dispatches the preset's chain through the (fake) driver, and each
  // prompt returns the agent's text — proving the driver-backed bridge works.
  const run = await loop!.handle({ kind: 'major-change', summary: 'reworked auth' })
  assert.equal(run.matched, true)
  assert.deepEqual(run.outcomes.map(o => o.promptId), ['code-review'])
  assert.equal(run.outcomes[0]!.ok, true)
  assert.ok(run.outcomes[0]!.passes[0]!.text.length > 0)
})

test('no loop is exposed without a preset', async () => {
  const { loop } = await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
  })
  assert.equal(loop, undefined)
})
