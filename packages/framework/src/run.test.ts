import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { defineDomainPreset, defineFrameworkExtension, defineLoop, definePersona, defineSkill } from '@gemstack/ai-autopilot'
import type { Prompt } from '@gemstack/ai-autopilot'
import { DEFAULT_MAX_PASSES, requestChoices, requestMultiSelect, runFramework, type ChoicesOption, type MultiSelectOption } from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import { FakeDriver, type Driver, type DriverSession } from './driver/index.js'
import type { ChoiceRequest, FrameworkEvent } from './events.js'

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

test('runFramework accumulates per-turn usage and emits a running total (#322)', async () => {
  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(), // every scripted turn reports $0.02 usage
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
  })

  const usage = events.filter(e => e.kind === 'usage')
  assert.ok(usage.length >= 1)
  const last = usage.at(-1)!
  assert.equal(last.kind, 'usage')
  if (last.kind !== 'usage') return
  // One usage event per turn that reported usage; totals grow monotonically.
  assert.equal(last.turns, usage.length)
  assert.ok(Math.abs(last.costUsd - last.turns * 0.02) < 1e-9)
  assert.ok(last.cacheReadTokens > 0)
  // No cap was set, so the total carries no budget and the run finished cleanly.
  assert.equal(last.budgetUsd, undefined)
  const end = events.at(-1)!
  assert.equal(end.kind === 'end' && end.ok, true)
})

test('runFramework stops itself once the budget cap is reached (#322)', async () => {
  const events: FrameworkEvent[] = []
  // $0.01 cap trips on the very first $0.02 turn (the architect).
  await assert.rejects(
    runFramework({
      intent: FAKE_INTENT,
      driver: fakeDriver(),
      cwd: '/tmp/ws',
      signals: FAKE_SIGNALS,
      budgetUsd: 0.01,
      onEvent: e => events.push(e),
    }),
  )

  const usage = events.filter(e => e.kind === 'usage')
  assert.ok(usage.length >= 1)
  assert.equal(usage[0]!.kind === 'usage' && usage[0]!.budgetUsd, 0.01)
  assert.ok(events.some(e => e.kind === 'log' && e.message.startsWith('Budget reached:')))

  const end = events.at(-1)!
  assert.equal(end.kind, 'end')
  if (end.kind !== 'end') return
  // A budget stop is a clean stop, not a failure.
  assert.equal(end.ok, false)
  assert.equal(end.stopped, true)
  assert.match(end.detail ?? '', /budget reached/)
  // The run stopped early: it never reached the deploy/production-grade tail.
  assert.ok(!events.some(e => e.kind === 'bootstrap' && e.event.type === 'done'))
})

test('a plan-approval gate parked for a pick unblocks when the budget trips (#322)', async () => {
  const events: FrameworkEvent[] = []
  // The gate awaits a pick that never arrives; the budget cap trips on the first
  // (architect) turn and must unblock it rather than hang the run.
  await assert.rejects(
    runFramework({
      intent: FAKE_INTENT,
      driver: fakeDriver(),
      cwd: '/tmp/ws',
      signals: FAKE_SIGNALS,
      budgetUsd: 0.01,
      requestChoice: () => new Promise<never>(() => {}),
      onEvent: e => events.push(e),
    }),
  )
  assert.ok(events.some(e => e.kind === 'choice'))
  const end = events.at(-1)!
  assert.equal(end.kind === 'end' && end.stopped, true)
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

test('repo memory files frame the agent: contents + a maintain instruction (#260)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    memory: [
      { name: 'CODE-OVERVIEW.md', purpose: 'a map of the codebase', content: 'A blog with comments.' },
      { name: 'DECISIONS.md', purpose: 'the decision log', agentMaintained: false },
    ],
    onEvent: () => {},
  })
  assert.match(system(), /Project memory/)
  assert.match(system(), /A blog with comments\./) // contents inlined as context
  assert.match(system(), /Keep these up to date[\s\S]*CODE-OVERVIEW\.md/)
  assert.match(system(), /Read-only[\s\S]*DECISIONS\.md/) // agent must not clobber our ledger write
})

test('no memory option leaves the framing unchanged (#260)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: FAKE_SIGNALS, onEvent: () => {} })
  assert.doesNotMatch(system(), /Project memory/)
})

/** A minimal domain preset whose major-change loop runs one review prompt. */
function reviewPreset() {
  const review: Prompt = {
    id: 'review',
    name: 'review',
    title: 'Review',
    description: 'Review the change.',
    instructions: 'Review the app and end with a { blockers } verdict.',
    passes: 1,
    appliesTo: [],
  }
  return defineDomainPreset({
    name: 'test-domain',
    title: 'Test Domain',
    loops: [defineLoop({ on: 'major-change', run: ['review'] })],
    prompts: [review],
    skills: [],
  })
}

test("a domain preset's loop drives the production-grade review phase (#252)", async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({
    turns: [
      { text: '```json\n{"stack":"X","narration":"n","decisions":[]}\n```' }, // architect
      { text: 'Built the app.' }, // build
      { text: 'Reviewed.\n```json\n{"blockers":[]}\n```' }, // the domain review prompt, clean
    ],
    sessionId: 'test',
  })
  const { result, loop } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: reviewPreset(),
    onEvent: e => events.push(e),
  })
  assert.ok(loop) // the preset loop was materialized...
  assert.ok(events.some(e => e.kind === 'log' && /Test Domain loop drives/.test(e.message))) // ...and announced as the reviewer
  assert.equal(result.productionGrade, true)
  assert.equal(result.passes, 1) // cleared on the first domain-review pass (not the built-in checklist)
})

test('the domain review loop blocks, improve runs, then it clears (#252)', async () => {
  const driver = new FakeDriver({
    turns: [
      { text: '```json\n{"stack":"X","narration":"n","decisions":[]}\n```' }, // architect
      { text: 'Built the app.' }, // build
      { text: 'Reviewed.\n```json\n{"blockers":["needs error handling"]}\n```' }, // review, pass 1: blocks
      { text: 'Added error handling.' }, // improve
      { text: 'Reviewed.\n```json\n{"blockers":[]}\n```' }, // review, pass 2: clean
    ],
    sessionId: 'test',
  })
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: reviewPreset(),
    onEvent: () => {},
  })
  assert.equal(result.passes, 2) // blocked once, improved, cleared — the domain loop drove both passes
  assert.equal(result.productionGrade, true)
})

/** A preset with both a major-change and a bug-fix loop, each running a sentinel-tagged prompt. */
function dualLoopPreset(opts: { defaultEvent?: string } = {}) {
  const prompt = (id: string, sentinel: string): Prompt => ({
    id,
    name: id,
    title: id,
    description: '',
    instructions: `${sentinel} — review and end with a { blockers } verdict.`,
    passes: 1,
    appliesTo: [],
  })
  return defineDomainPreset({
    name: 'test-domain',
    title: 'Test Domain',
    ...(opts.defaultEvent ? { defaultEvent: opts.defaultEvent } : {}),
    loops: [
      defineLoop({ on: 'major-change', run: ['major-review'] }),
      defineLoop({ on: 'bug-fix', run: ['bug-review'] }),
    ],
    prompts: [prompt('major-review', 'MAJOR-SENTINEL'), prompt('bug-review', 'BUGFIX-SENTINEL')],
    skills: [],
  })
}

/** A fake driver that records every prompt text it is sent, so a test can see which loop fired. */
function promptRecordingDriver(): { driver: Driver; prompts: () => string[] } {
  const sent: string[] = []
  const inner = new FakeDriver({
    turns: [
      { text: '```json\n{"stack":"X","narration":"n","decisions":[]}\n```' }, // architect
      { text: 'Built the app.' }, // build
      { text: 'Reviewed.\n```json\n{"blockers":[]}\n```' }, // review, clean
    ],
    sessionId: 'test',
  })
  const driver: Driver = {
    name: 'fake',
    start: async opts => {
      const session = await inner.start(opts)
      const wrapped: DriverSession = {
        id: session.id,
        cwd: session.cwd,
        prompt: (text, o) => {
          sent.push(text)
          return session.prompt(text, o)
        },
        dispose: () => session.dispose(),
      }
      return wrapped
    },
  }
  return { driver, prompts: () => sent }
}

test('a bug-fix build event fires the preset bug-fix loop, not major-change (#265)', async () => {
  const events: FrameworkEvent[] = []
  const { driver, prompts } = promptRecordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: dualLoopPreset(),
    buildEvent: 'bug-fix',
    onEvent: e => events.push(e),
  })
  assert.ok(events.some(e => e.kind === 'log' && /Test Domain loop drives the bug-fix review/.test(e.message)))
  assert.ok(prompts().some(p => p.includes('BUGFIX-SENTINEL'))) // the bug-fix chain ran...
  assert.ok(!prompts().some(p => p.includes('MAJOR-SENTINEL'))) // ...and the major-change chain did not
})

test('a preset defaultEvent selects the loop; an explicit buildEvent overrides it (#265)', async () => {
  const byDefault = promptRecordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver: byDefault.driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: dualLoopPreset({ defaultEvent: 'bug-fix' }),
    onEvent: () => {},
  })
  assert.ok(byDefault.prompts().some(p => p.includes('BUGFIX-SENTINEL'))) // preset default alone reaches bug-fix

  const overridden = promptRecordingDriver()
  await runFramework({
    intent: FAKE_INTENT,
    driver: overridden.driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    preset: dualLoopPreset({ defaultEvent: 'bug-fix' }),
    buildEvent: 'major-change',
    onEvent: () => {},
  })
  assert.ok(overridden.prompts().some(p => p.includes('MAJOR-SENTINEL'))) // run choice wins over the preset default
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

test('the plan-approval gate (#304) pauses on a choice, proceeds, and keeps the plan', async () => {
  const events: FrameworkEvent[] = []
  const seen: ChoiceRequest[] = []
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    deploy: FAKE_DEPLOY,
    onEvent: e => events.push(e),
    requestChoice: async req => {
      seen.push(req)
      return { picked: 'proceed', by: 'user' }
    },
  })

  // The gate emitted one choice, offering "proceed" (recommended) plus the
  // architect's alternative as "Use Next.js instead".
  assert.equal(seen.length, 1)
  const choice = events.find(e => e.kind === 'choice')
  assert.ok(choice && choice.kind === 'choice')
  assert.equal(choice.recommended, 'proceed')
  assert.ok(choice.options.some(o => o.id === 'proceed'))
  assert.ok(choice.options.some(o => o.id === 'alt:0' && /Next\.js/.test(o.label)))

  // It resolved to the pick, and the choice came before the architect narration.
  const resolved = events.find(e => e.kind === 'choice-resolved')
  assert.ok(resolved && resolved.kind === 'choice-resolved')
  assert.equal(resolved.picked, 'proceed')
  assert.equal(resolved.by, 'user')
  const ci = events.findIndex(e => e.kind === 'choice')
  const ai = events.findIndex(e => e.kind === 'bootstrap' && e.event.type === 'architect')
  assert.ok(ci >= 0 && ai > ci)

  // Proceeding kept the original stack and still reached production-grade.
  const architect = events.find(e => e.kind === 'bootstrap' && e.event.type === 'architect')
  assert.ok(architect && architect.kind === 'bootstrap' && architect.event.type === 'architect')
  assert.match(architect.event.stack, /Vike \+ Prisma/)
  assert.equal(result.productionGrade, true)
})

test('without a requestChoice handler no choice events are emitted (#304)', async () => {
  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
  })
  assert.equal(events.some(e => e.kind === 'choice'), false)
  assert.equal(events.some(e => e.kind === 'choice-resolved'), false)
})

test('picking an alternative re-architects the run around it (#304)', async () => {
  const first = {
    stack: 'Vike + Prisma',
    narration: 'first plan',
    decisions: [{ choice: 'SSR', why: 'per-request data' }],
    alternatives: [{ option: 'Next.js', whyNot: 'edge deploy is more constrained' }],
  }
  const second = {
    stack: 'Next.js + Postgres',
    narration: 'second plan',
    decisions: [{ choice: 'App Router', why: 'the user chose it' }],
    alternatives: [],
  }
  // A driver that answers by prompt: the steered re-architect returns the Next.js
  // plan, the first architect the Vike plan, the checklist passes clean.
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/You are the architect/.test(prompt) && /prefers Next\.js/.test(prompt))
        return '```json\n' + JSON.stringify(second) + '\n```'
      if (/You are the architect/.test(prompt)) return '```json\n' + JSON.stringify(first) + '\n```'
      if (/production-grade checklist/.test(prompt)) return 'Reviewed.\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'fake-realt',
  })

  const events: FrameworkEvent[] = []
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
    requestChoice: async () => ({ picked: 'alt:0', by: 'user' }),
  })

  // Re-architecting was narrated, and the final narrated stack is the alternative.
  assert.ok(events.some(e => e.kind === 'log' && /Re-architecting around your choice: Next\.js/.test(e.message)))
  const architect = events.find(e => e.kind === 'bootstrap' && e.event.type === 'architect')
  assert.ok(architect && architect.kind === 'bootstrap' && architect.event.type === 'architect')
  assert.match(architect.event.stack, /Next\.js \+ Postgres/)
  assert.equal(result.productionGrade, true)
})

test('the gate re-fires to approve the re-architected plan (#324)', async () => {
  const first = {
    stack: 'Vike + Prisma',
    narration: 'first plan',
    decisions: [{ choice: 'SSR', why: 'per-request data' }],
    alternatives: [{ option: 'Next.js', whyNot: 'edge deploy is more constrained' }],
  }
  const second = {
    stack: 'Next.js + Postgres',
    narration: 'second plan',
    decisions: [{ choice: 'App Router', why: 'the user chose it' }],
    alternatives: [{ option: 'Remix', whyNot: 'smaller ecosystem' }],
  }
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/You are the architect/.test(prompt) && /prefers Next\.js/.test(prompt))
        return '```json\n' + JSON.stringify(second) + '\n```'
      if (/You are the architect/.test(prompt)) return '```json\n' + JSON.stringify(first) + '\n```'
      if (/production-grade checklist/.test(prompt)) return 'Reviewed.\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'refire',
  })

  const events: FrameworkEvent[] = []
  // Round 0: pick the alternative (Next.js). Round 1: approve the re-architected plan.
  const picks = ['alt:0', 'proceed']
  let round = 0
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
    requestChoice: async () => ({ picked: picks[round++] ?? 'proceed', by: 'user' as const }),
  })

  // The gate fired twice: once on the initial plan, once on the re-architected one.
  const choices = events.filter(e => e.kind === 'choice')
  assert.equal(choices.length, 2)
  assert.equal(choices[0]!.kind === 'choice' && choices[0]!.id, 'plan-approval')
  assert.equal(choices[1]!.kind === 'choice' && choices[1]!.id, 'plan-approval-1')
  // The second gate offered the re-architected (Next.js) plan for approval.
  assert.ok(choices[1]!.kind === 'choice' && /Next\.js \+ Postgres/.test(choices[1]!.options[0]!.label))
  assert.ok(events.some(e => e.kind === 'log' && /Re-architecting around your choice: Next\.js/.test(e.message)))
  assert.equal(result.productionGrade, true)
})

const MS_OPTS: MultiSelectOption[] = [
  { id: 'p0', label: 'auth flow', default: true },
  { id: 'p1', label: 'routing' },
  { id: 'p2', label: 'data layer', detail: 'rated 2/10', default: true },
]

test('requestMultiSelect headless: auto-accepts the default-checked set (#332)', async () => {
  const events: FrameworkEvent[] = []
  const selected = await requestMultiSelect({
    id: 'ms',
    title: 'Pick problems',
    options: MS_OPTS,
    emit: e => events.push(e),
  })
  assert.deepEqual(selected, ['p0', 'p2']) // the two defaults
  const choice = events.find(e => e.kind === 'choice')
  assert.ok(choice && choice.kind === 'choice' && choice.multi === true && choice.recommended === undefined)
  const resolved = events.find(e => e.kind === 'choice-resolved')
  assert.ok(resolved && resolved.kind === 'choice-resolved')
  assert.deepEqual((resolved as { picked: unknown }).picked, ['p0', 'p2'])
  assert.equal((resolved as { by: string }).by, 'auto')
})

test('requestMultiSelect returns the user-picked subset, filtered to valid ids (#332)', async () => {
  const events: FrameworkEvent[] = []
  const selected = await requestMultiSelect({
    id: 'ms',
    title: 'Pick problems',
    options: MS_OPTS,
    emit: e => events.push(e),
    // The user unchecks a default (p0), keeps p1, and a stray id is dropped.
    requestChoice: async () => ({ picked: ['p1', 'p2', 'bogus'], by: 'user' }),
  })
  assert.deepEqual(selected, ['p1', 'p2'])
})

test('requestMultiSelect resolves to the defaults if the run aborts while parked (#332)', async () => {
  const events: FrameworkEvent[] = []
  const ac = new AbortController()
  const selected = await requestMultiSelect({
    id: 'ms',
    title: 'Pick problems',
    options: MS_OPTS,
    emit: e => events.push(e),
    signal: ac.signal,
    // Never resolves on its own; the abort must unblock it.
    requestChoice: () => {
      ac.abort()
      return new Promise(() => {})
    },
  })
  assert.deepEqual(selected, ['p0', 'p2']) // fell back to the defaults, not a hang
})

test('requestMultiSelect can resolve to an empty set when the user checks nothing (#332)', async () => {
  const selected = await requestMultiSelect({
    id: 'ms',
    title: 'Pick problems',
    options: MS_OPTS,
    emit: () => {},
    requestChoice: async () => ({ picked: [], by: 'user' }),
  })
  assert.deepEqual(selected, [])
})

test('a build turn that stops to ask fires a live gate and resumes on the pick (#337)', async () => {
  const plan = {
    stack: 'Vike + Prisma',
    narration: 'a plan',
    decisions: [{ choice: 'SSR', why: 'per-request data' }],
    alternatives: [],
  }
  const awaitBlock =
    'I need a decision first.\n```await-choices\n' +
    '{ "title": "Which data store?", "options": [{ "id": "sqlite", "label": "SQLite" }, { "id": "pg", "label": "Postgres" }], "recommended": "sqlite" }\n' +
    '```'
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/You are the architect/.test(prompt)) return '```json\n' + JSON.stringify(plan) + '\n```'
      if (/Build this app end to end/.test(prompt)) return awaitBlock // the build stops to ask
      if (/You paused to ask/.test(prompt)) return 'Built it with Postgres. Done.' // the resume
      if (/production-grade checklist/.test(prompt)) return 'Reviewed.\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'gate337',
  })

  const events: FrameworkEvent[] = []
  const prompts: string[] = []
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => {
      events.push(e)
      if (e.kind === 'driver' && e.event.type === 'start') prompts.push(e.event.prompt)
    },
    requestChoice: async () => ({ picked: 'pg', by: 'user' }),
  })

  // The agent-authored choice surfaced as a live gate with the offered options.
  // (The architect plan-approval gate #304 also fires first; find ours by id.)
  const choice = events.find(e => e.kind === 'choice' && e.id === 'await-choices')
  assert.ok(choice && choice.kind === 'choice')
  assert.equal(choice.title, 'Which data store?')
  assert.ok(choice.options.some(o => o.id === 'pg' && o.label === 'Postgres'))
  // The pick was narrated and the driver was re-prompted to continue from it.
  assert.ok(events.some(e => e.kind === 'log' && /Continuing with your choice: Postgres/.test(e.message)))
  assert.ok(prompts.some(p => /You paused to ask.*Which data store.*chose: Postgres/s.test(p)))
  assert.equal(result.productionGrade, true)
})

test('a build turn that stops to showMultiSelect fires a checklist gate and resumes (#339)', async () => {
  const plan = { stack: 'Vike', narration: 'p', decisions: [{ choice: 'x', why: 'y' }], alternatives: [] }
  const awaitBlock =
    'Rated the problems.\n```await-multiselect\n' +
    '{ "title": "Which problems to deep-dive?", "options": [{ "id": "auth", "label": "auth", "default": true }, { "id": "routing", "label": "routing" }] }\n' +
    '```'
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/You are the architect/.test(prompt)) return '```json\n' + JSON.stringify(plan) + '\n```'
      if (/Build this app end to end/.test(prompt)) return awaitBlock
      if (/You paused to ask/.test(prompt)) return 'Added the picks to TODO. Done.'
      if (/production-grade checklist/.test(prompt)) return 'Reviewed.\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'multi339',
  })

  const events: FrameworkEvent[] = []
  const prompts: string[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => {
      events.push(e)
      if (e.kind === 'driver' && e.event.type === 'start') prompts.push(e.event.prompt)
    },
    // The user unchecks the default `auth` and keeps `routing`.
    requestChoice: async req => (req.multi ? { picked: ['routing'], by: 'user' } : { picked: 'proceed', by: 'user' }),
  })

  const gate = events.find(e => e.kind === 'choice' && e.id === 'await-multiselect')
  assert.ok(gate && gate.kind === 'choice' && gate.multi === true)
  assert.ok(gate.options.some(o => o.id === 'auth' && o.default === true))
  // Resumed with the user's selection (routing only), not the defaults.
  assert.ok(events.some(e => e.kind === 'log' && /Continuing with your choice: routing/.test(e.message)))
  assert.ok(prompts.some(p => /You paused to ask.*chose: routing/s.test(p)))
})

test('a re-architect turn that stops to ask fires a live gate instead of a stub plan (#356)', async () => {
  const first = {
    stack: 'Vike + Prisma',
    narration: 'first plan',
    decisions: [{ choice: 'SSR', why: 'data' }],
    alternatives: [{ option: 'Next.js', whyNot: 'coupling' }],
  }
  const steered = { stack: 'Next.js + Postgres', narration: 'steered plan', decisions: [{ choice: 'RSC', why: 'fits' }], alternatives: [] }
  const awaitBlock =
    'One call before I re-decide.\n```await-choices\n' +
    '{ "title": "Server components?", "options": [{ "id": "yes", "label": "Yes" }, { "id": "no", "label": "No" }], "recommended": "yes" }\n' +
    '```'
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      // Order matters: the re-architect prompt also matches "You are the architect".
      if (/You paused to ask/.test(prompt)) return '```json\n' + JSON.stringify(steered) + '\n```'
      if (/The user reviewed your first choice/.test(prompt)) return awaitBlock // re-architect stops to ask
      if (/You are the architect/.test(prompt)) return '```json\n' + JSON.stringify(first) + '\n```'
      if (/Build this app end to end/.test(prompt)) return 'built'
      if (/production-grade checklist/.test(prompt)) return 'ok\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'rearch356',
  })

  const events: FrameworkEvent[] = []
  await runFramework({
    intent: FAKE_INTENT,
    driver,
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
    requestChoice: async req => {
      if (req.id === 'plan-approval') return { picked: 'alt:0', by: 'user' } // steer to Next.js -> reArchitect
      if (req.id === 'await-choices') return { picked: 'no', by: 'user' } // answer the agent's question
      return { picked: 'proceed', by: 'user' } // approve the re-architected plan
    },
  })

  // The agent's mid-re-architect question surfaced as a live gate...
  const gate = events.find(e => e.kind === 'choice' && e.id === 'await-choices')
  assert.ok(gate && gate.kind === 'choice')
  assert.equal(gate.title, 'Server components?')
  assert.ok(events.some(e => e.kind === 'log' && /Continuing with your choice: No/.test(e.message)))
  // ...and the re-approval gate (#324) offered the REAL steered plan, not the stub fallback.
  const reApproval = events.find(e => e.kind === 'choice' && e.id === 'plan-approval-1')
  assert.ok(reApproval && reApproval.kind === 'choice')
  assert.ok(reApproval.options.some(o => o.label === 'Proceed: Next.js + Postgres'))
})

test('without a requestChoice handler a build that asks is not gated (#337 headless)', async () => {
  const plan = { stack: 'Vike', narration: 'p', decisions: [{ choice: 'x', why: 'y' }], alternatives: [] }
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/You are the architect/.test(prompt)) return '```json\n' + JSON.stringify(plan) + '\n```'
      if (/Build this app end to end/.test(prompt)) return 'built it\n```await-choices\n{ "options": [{ "label": "A" }] }\n```'
      if (/production-grade checklist/.test(prompt)) return 'Reviewed.\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'headless337',
  })
  const events: FrameworkEvent[] = []
  await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: FAKE_SIGNALS, onEvent: e => events.push(e) })
  assert.equal(events.some(e => e.kind === 'choice'), false)
  assert.equal(events.some(e => e.kind === 'choice-resolved'), false)
})

const CH_OPTS: ChoicesOption[] = [
  { id: 'a', label: 'Interpretation A' },
  { id: 'b', label: 'Interpretation B', detail: 'less likely' },
]

test('requestChoices headless: auto-accepts the recommended option (#335)', async () => {
  const events: FrameworkEvent[] = []
  const picked = await requestChoices({
    id: 'ch',
    title: 'Which interpretation?',
    options: CH_OPTS,
    recommended: 'b',
    emit: e => events.push(e),
  })
  assert.equal(picked, 'b')
  const choice = events.find(e => e.kind === 'choice')
  assert.ok(choice && choice.kind === 'choice' && choice.multi === undefined && choice.recommended === 'b')
  const resolved = events.find(e => e.kind === 'choice-resolved')
  assert.ok(resolved && resolved.kind === 'choice-resolved')
  assert.equal((resolved as { picked: unknown }).picked, 'b')
  assert.equal((resolved as { by: string }).by, 'auto')
})

test('requestChoices defaults the recommended option to the first when none is given (#335)', async () => {
  const events: FrameworkEvent[] = []
  const picked = await requestChoices({ id: 'ch', title: 'Pick one', options: CH_OPTS, emit: e => events.push(e) })
  assert.equal(picked, 'a')
  const choice = events.find(e => e.kind === 'choice')
  assert.ok(choice && choice.kind === 'choice' && choice.recommended === 'a')
})

test('requestChoices returns the user pick, falling back to recommended for an invalid id (#335)', async () => {
  const good = await requestChoices({
    id: 'ch',
    title: 'Pick one',
    options: CH_OPTS,
    recommended: 'a',
    emit: () => {},
    requestChoice: async () => ({ picked: 'b', by: 'user' }),
  })
  assert.equal(good, 'b')
  const bogus = await requestChoices({
    id: 'ch',
    title: 'Pick one',
    options: CH_OPTS,
    recommended: 'a',
    emit: () => {},
    requestChoice: async () => ({ picked: 'nope', by: 'user' }),
  })
  assert.equal(bogus, 'a') // an unknown id falls back to the recommended option
})

test('requestChoices resolves to the recommended option if the run aborts while parked (#335)', async () => {
  const ac = new AbortController()
  const picked = await requestChoices({
    id: 'ch',
    title: 'Pick one',
    options: CH_OPTS,
    recommended: 'b',
    emit: () => {},
    signal: ac.signal,
    // Never resolves on its own; the abort must unblock it.
    requestChoice: () => {
      ac.abort()
      return new Promise(() => {})
    },
  })
  assert.equal(picked, 'b') // fell back to the recommended option, not a hang
})

test('a fake run skips the backlog loop by default; the demo stays deterministic (#323)', async () => {
  const events: FrameworkEvent[] = []
  const result = await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    onEvent: e => events.push(e),
  })
  assert.equal(result.todo, undefined)
  assert.equal(events.some(e => e.kind === 'log' && /Backlog/.test(e.message)), false)
})

test('runFramework runs the backlog loop after the build when opted in (#323)', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const cwd = await mkdtemp(join(tmpdir(), 'framework-run-todo-'))
  await writeFile(join(cwd, 'TODO.md'), '- [ ] leftover task\n')
  try {
    const events: FrameworkEvent[] = []
    // The fake script never edits the backlog, so the loop stall-stops after two
    // attempts — proving the wiring runs post-build with the run's own session.
    const result = await runFramework({
      intent: FAKE_INTENT,
      driver: fakeDriver(),
      cwd,
      signals: FAKE_SIGNALS,
      todoLoop: true,
      onEvent: e => events.push(e),
    })
    assert.deepEqual(result.todo, { completed: 2, reason: 'stalled', file: 'TODO.md' })
    assert.ok(events.some(e => e.kind === 'log' && /Backlog: TODO\.md has 1 open item\(s\)/.test(e.message)))
    // The loop runs before the run's end event.
    const endIndex = events.findIndex(e => e.kind === 'end')
    const stallIndex = events.findIndex(e => e.kind === 'log' && /no progress/.test(e.message))
    assert.ok(stallIndex !== -1 && stallIndex < endIndex)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
