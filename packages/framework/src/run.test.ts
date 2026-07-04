import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { defineFrameworkExtension, definePersona, defineSkill } from '@gemstack/ai-autopilot'
import { DEFAULT_MAX_PASSES, runFramework } from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import type { Driver } from './driver/index.js'
import type { FrameworkEvent } from './events.js'

/** A driver that records the `system` framing it is started with, delegating the run to the fake. */
function recordingDriver(): { driver: Driver; system: () => string } {
  const fd = fakeDriver()
  let captured = ''
  // Name it 'fake' so the workspace-verify stays off (no fs access in this unit test).
  const driver: Driver = {
    name: 'fake',
    start: opts => {
      captured = opts.system ?? ''
      return fd.start(opts)
    },
  }
  return { driver, system: () => captured }
}

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

test('runFramework surfaces the wrapped agent real session id via session-update', async () => {
  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(), // reports sessionId "fake-orders-app"
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
  })

  const updates = events.filter(e => e.kind === 'session-update')
  // The fake reports one stable id across all prompts, so it fires exactly once.
  assert.equal(updates.length, 1)
  assert.equal(updates[0]!.kind === 'session-update' && updates[0]!.sessionId, 'fake-orders-app')
  // No link template was given, so the update carries no link.
  assert.equal(updates[0]!.kind === 'session-update' && updates[0]!.sessionLink, undefined)
  // It arrives after the initial session event (id is not known at start).
  const sessionIdx = events.findIndex(e => e.kind === 'session')
  const updateIdx = events.findIndex(e => e.kind === 'session-update')
  assert.ok(sessionIdx >= 0 && updateIdx > sessionIdx)
})

test('runFramework resolves a {sessionId} link template once the id is known', async () => {
  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    sessionLink: 'https://code.example.com/s/{sessionId}',
    onEvent: e => events.push(e),
  })

  // The template cannot resolve at start, so the initial session event omits it.
  const session = events.find(e => e.kind === 'session')
  assert.ok(session && session.kind === 'session')
  assert.equal(session.sessionLink, undefined)

  // Once the id is known, the resolved URL is surfaced.
  const update = events.find(e => e.kind === 'session-update')
  assert.ok(update && update.kind === 'session-update')
  assert.equal(update.sessionLink, 'https://code.example.com/s/fake-orders-app')
})

test('runFramework shows a literal session link immediately (no template)', async () => {
  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    sessionLink: 'https://code.example.com/live',
    onEvent: e => events.push(e),
  })

  // A literal URL (no placeholder) is shown right away on the session event.
  const session = events.find(e => e.kind === 'session')
  assert.ok(session && session.kind === 'session')
  assert.equal(session.sessionLink, 'https://code.example.com/live')
})

test('--compose-extensions frames the agent with vike-auth, not hand-rolled auth (#186)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    composeExtensions: true,
    onEvent: () => {},
  })
  assert.match(system(), /vike-auth/)
  assert.match(system(), /npm install vike-auth/)
})

test('--compose-extensions is ignored on a non-Vike preset and falls back with a log (#202)', async () => {
  const events: FrameworkEvent[] = []
  const { driver, system } = recordingDriver()
  const { detection } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: { dependencies: ['next'] }, // detect Next, not Vike
    composeExtensions: true,
    onEvent: e => events.push(e),
  })

  // The vike-* extensions are Vike-only, so a Next project does not get them.
  assert.equal(detection.framework, 'Next.js')
  assert.doesNotMatch(system(), /vike-auth/)
  // And we say why, rather than silently framing Next with vike composers.
  assert.ok(
    events.some(e => e.kind === 'log' && /--compose-extensions ignored/.test(e.message)),
    'expected a log explaining the compose fallback',
  )
})

test('without --compose-extensions the default framing has no vike-auth (publish-safe)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: () => {},
  })
  assert.doesNotMatch(system(), /vike-auth/)
})

test('Vike arrives as a skill (llms.txt pointer) in the framing (#190)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS, // has vike-react -> the Vike skill activates
    onEvent: () => {},
  })
  assert.match(system(), /https:\/\/vike\.dev\/llms\.txt/)
})

test('the framework page builder is framed via its skill, not a preset persona', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: FAKE_SIGNALS, onEvent: () => {} })
  // The vike-page-builder persona (page-builder conventions) rides the Vike skill.
  assert.match(system(), /You build UI on Vike \(Vite \+ SSR\), which is renderer-agnostic/)
})

test('an empty from-scratch project is still framed with the flagship page builder (skill fallback)', async () => {
  const { driver, system } = recordingDriver()
  // No signals match any skill, so only preset selection (fallback = flagship Vike)
  // brings the framework skill in. Its page builder must still frame the agent.
  await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: {}, onEvent: () => {} })
  assert.match(system(), /You build UI on Vike \(Vite \+ SSR\), which is renderer-agnostic/)
  assert.match(system(), /https:\/\/vike\.dev\/llms\.txt/)
})

test('a registered extension auto-activates by its signal, no opt-in needed (#190)', async () => {
  const { driver, system } = recordingDriver()
  const audit = defineFrameworkExtension({
    name: 'framework-audit',
    capability: 'audit',
    personas: [definePersona({ name: 'auditor', role: 'audits', systemPrompt: 'AUDIT-LOG-EVERYTHING sentinel.' })],
    signals: { dependencies: ['@prisma/client'] }, // present in FAKE_SIGNALS
  })
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    extensions: [audit],
    onEvent: () => {},
  })
  assert.match(system(), /AUDIT-LOG-EVERYTHING sentinel/)
})

test('an active extension pulls its own skill into the framing (#190)', async () => {
  const { driver, system } = recordingDriver()
  const audit = defineFrameworkExtension({
    name: 'framework-audit',
    capability: 'audit',
    personas: [definePersona({ name: 'auditor', role: 'audits', systemPrompt: 'audit sentinel' })],
    skills: [defineSkill({ name: 'audit-guide', title: 'Audit Guide', description: 'd', url: 'https://x/audit/llms.txt' })],
    signals: { dependencies: ['@prisma/client'] }, // present in FAKE_SIGNALS
  })
  await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: FAKE_SIGNALS, extensions: [audit], onEvent: () => {} })
  assert.match(system(), /https:\/\/x\/audit\/llms\.txt/)
})

test('the default pass budget is raised for from-scratch builds (#182)', () => {
  // 3 was too low: the first passes go to bootstrapping an empty workspace.
  assert.equal(DEFAULT_MAX_PASSES, 5)
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
