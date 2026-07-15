import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { defineDomainPreset, defineLoop } from '@gemstack/ai-autopilot'
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
})

test('a domain preset drives the run and is narrated', async () => {
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

  // The exact system prompt is surfaced for transparency (#343), not just handed
  // to the driver.
  const sys = events.find(e => e.kind === 'system-prompt')
  assert.ok(sys, 'a system-prompt event is emitted')
  assert.equal((sys as { text: string }).text, system())

  // It was narrated (title + active modes).
  const log = events.find(e => e.kind === 'log' && /Domain preset: Software Development/.test(e.message))
  assert.ok(log, 'domain preset is logged')
  assert.match((log as { message: string }).message, /modes: technical/)

  // The active modes are emitted for the dashboard checkboxes (#272): both known
  // modes, with only the active one on.
  const modes = events.find(e => e.kind === 'modes')
  assert.deepEqual(modes, { kind: 'modes', all: ['autopilot', 'technical'], active: ['technical'] })

  // The run still completes normally.
  assert.equal(result.productionGrade, true)
})

test('no modes event is emitted without a domain preset (#272)', async () => {
  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
  })
  assert.equal(
    events.some(e => e.kind === 'modes'),
    false,
  )
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

test('the #326 action layer is injected even with the built-in prompt off (#500)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    antiLazyPill: false, // --vanilla: drops the built-in #326 prompt, so promptBlock is empty
  })

  // The built-in prompt is gone, but the emit protocols still ride the system channel —
  // else the agent never learns how to signal set-session-name / ready-for-merge, so
  // setReadyForMerge() and the --post-merge prompt silently never fire (the build path used
  // to nest these inside the promptBlock branch; the direct-prompt path always kept them).
  assert.ok(!system().includes('# System prompt'), 'built-in #326 prompt is off')
  assert.match(system(), /## Ready for merge/) // SIGNAL_PROTOCOL (#326)
  assert.match(system(), /```ready-for-merge/)
  assert.match(system(), /## Awaiting a choice/) // AWAIT_PROTOCOL (#337)
})
