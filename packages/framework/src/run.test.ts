import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineDomainPreset, defineLoop } from '@gemstack/ai-autopilot'
import type { Prompt } from '@gemstack/ai-autopilot'
import { DEFAULT_MAX_PASSES, requestChoices, requestMultiSelect, runAwaitRounds, runFramework, type ChoicesOption, type MultiSelectOption } from './run.js'
import { FAKE_DEPLOY, FAKE_INTENT, FAKE_SIGNALS, fakeDriver } from './fake-script.js'
import { FakeDriver, type Driver, type DriverSession } from './driver/index.js'
import { composeRunSystem } from './system-prompt.js'
import type { ChoiceRequest, FrameworkEvent } from './events.js'
import { MAX_AWAIT_ROUNDS, PLAN_DECLINED_MESSAGE } from './turn-gate.js'

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

  // The deploy phase decided SSR -> cloudflare.
  assert.equal(result.deploy?.plan.target, 'cloudflare')

  // We surfaced the wrapped agent's own progress.
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
  // The fake driver prices its turns, so the total carries a cost.
  assert.ok(Math.abs(last.costUsd! - last.turns * 0.02) < 1e-9)
  assert.ok(last.cacheReadTokens > 0)
  // No cap was set, so the total carries no budget and the run finished cleanly.
  assert.equal(last.budgetUsd, undefined)
  const end = events.at(-1)!
  assert.equal(end.kind === 'end' && end.ok, true)
})

test('runFramework stops itself once the budget cap is reached (#322)', async () => {
  const events: FrameworkEvent[] = []
  // $0.01 cap trips on the very first $0.02 turn (the build).
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

test('the run system channel is exactly composeRunSystem, with nothing appended (#547)', async () => {
  const { driver, system } = recordingDriver()
  await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: FAKE_SIGNALS, onEvent: () => {} })
  // runFramework composes no framing of its own: detection narrates, it never reaches the prompt.
  assert.equal(system(), composeRunSystem({ tf: { prompt: FAKE_INTENT, params: { autopilot: false } } }))
})

test('detected deps never reach the system channel (#547)', async () => {
  const { driver, system } = recordingDriver()
  // FAKE_SIGNALS carries vike-react + @prisma/client; none of it may frame the agent.
  const { detection } = await runFramework({ intent: FAKE_INTENT, driver, cwd: '/tmp/ws', signals: FAKE_SIGNALS, onEvent: () => {} })
  assert.equal(detection.framework, 'Vike') // detection still happens...
  assert.doesNotMatch(system(), /vike-auth|llms\.txt|Skill:|Persona:|Project memory/) // ...but stays out of the prompt
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
  })
}

test("a domain preset's loop drives the production-grade review phase (#252)", async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({
    turns: [
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
  })
}

/** A fake driver that records every prompt text it is sent, so a test can see which loop fired. */
function promptRecordingDriver(): { driver: Driver; prompts: () => string[] } {
  const sent: string[] = []
  const inner = new FakeDriver({
    turns: [
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
  const awaitBlock =
    'I need a decision first.\n```await-choices\n' +
    '{ "title": "Which data store?", "options": [{ "id": "sqlite", "label": "SQLite" }, { "id": "pg", "label": "Postgres" }], "recommended": "sqlite" }\n' +
    '```'
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
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
  const awaitBlock =
    'Rated the problems.\n```await-multiselect\n' +
    '{ "title": "Which problems to deep-dive?", "options": [{ "id": "auth", "label": "auth", "default": true }, { "id": "routing", "label": "routing" }] }\n' +
    '```'
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
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

test('a build turn that stops for plan approval resumes on Approve (#358)', async () => {
  const awaitBlock =
    'The scope is large, so I wrote a plan.\n```await-confirmation\n' +
    '{ "title": "Approve the orders plan?", "file": "PLAN_orders.agent.md" }\n' +
    '```'
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/Build this app end to end/.test(prompt)) return awaitBlock
      if (/You paused to ask/.test(prompt)) return 'Built the plan out. Done.'
      if (/production-grade checklist/.test(prompt)) return 'Reviewed.\n```json\n{ "blockers": [] }\n```'
      return 'done'
    },
    sessionId: 'confirm358',
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
    requestChoice: async () => ({ picked: 'approve', by: 'user' }),
  })

  // The approval surfaced as a confirmation gate carrying the plan file.
  const gate = events.find(e => e.kind === 'choice' && e.id === 'await-confirmation')
  assert.ok(gate && gate.kind === 'choice')
  assert.equal(gate.confirm, true)
  assert.equal(gate.file, 'PLAN_orders.agent.md')
  assert.equal(gate.recommended, 'approve')
  assert.deepEqual(gate.options.map(o => o.id), ['approve', 'decline'])
  // Approved: the driver was re-prompted to continue and the run finished.
  assert.ok(events.some(e => e.kind === 'log' && /Continuing with your choice: Approve/.test(e.message)))
  assert.ok(prompts.some(p => /You paused to ask.*Approve the orders plan.*chose: Approve/s.test(p)))
  assert.equal(result.productionGrade, true)
})

test('a declined plan stops the run cleanly instead of building on (#358)', async () => {
  const awaitBlock = 'Plan written.\n```await-confirmation\n{ "title": "Approve?", "file": "PLAN_x.agent.md" }\n```'
  let resumed = false
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
      if (/Build this app end to end/.test(prompt)) return awaitBlock
      if (/You paused to ask/.test(prompt)) resumed = true
      if (/production-grade checklist/.test(prompt)) resumed = true // a declined plan must not be reviewed either
      return 'done'
    },
    sessionId: 'decline358',
  })

  const events: FrameworkEvent[] = []
  await assert.rejects(
    runFramework({
      intent: FAKE_INTENT,
      driver,
      cwd: '/tmp/ws',
      signals: FAKE_SIGNALS,
      onEvent: e => events.push(e),
      requestChoice: async req => ({ picked: req.confirm ? 'decline' : 'proceed', by: 'user' }),
    }),
  )
  assert.equal(resumed, false)
  assert.ok(events.some(e => e.kind === 'log' && /Plan declined, awaiting user instructions/.test(e.message)))
  // A decline is a clean stop, not a failure.
  const end = events.find(e => e.kind === 'end')
  assert.ok(end && end.kind === 'end')
  assert.equal(end.ok, false)
  assert.equal(end.stopped, true)
  assert.equal(end.detail, 'plan declined')
})

test('without a requestChoice handler a build that asks is not gated (#337 headless)', async () => {
  const driver = new FakeDriver({
    respond: (prompt: string): string => {
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

test('runFramework pauses the run once a consumption limit is reached (#529)', async () => {
  const events: FrameworkEvent[] = []
  await assert.rejects(
    runFramework({
      intent: FAKE_INTENT,
      driver: fakeDriver(),
      cwd: '/tmp/ws',
      signals: FAKE_SIGNALS,
      consumptionGate: () => 'daily',
      onEvent: e => events.push(e),
    }),
  )
  assert.ok(events.some(e => e.kind === 'log' && e.message === 'Daily consumption limit reached — pausing the run.'))
  const end = events.at(-1)!
  assert.equal(end.kind, 'end')
  // A limit is a clean stop, like the budget cap — not a failure.
  assert.equal(end.kind === 'end' && end.stopped, true)
  assert.ok(end.kind === 'end' && end.detail?.startsWith('Daily consumption limit reached'))
})

test('runFramework leaves a resume note on the backlog when it pauses (#529)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-pause-'))
  try {
    const events: FrameworkEvent[] = []
    await assert.rejects(
      runFramework({
        intent: FAKE_INTENT,
        driver: fakeDriver(),
        cwd,
        signals: FAKE_SIGNALS,
        consumptionGate: () => 'five-hour',
        onEvent: e => events.push(e),
      }),
    )
    // The backlog is what a later run drains, so the note needs no machinery of its own.
    const todo = await readFile(join(cwd, 'TODO.md'), 'utf8')
    assert.match(todo, /^- \[ \] Resume .+$/m)
    assert.ok(events.some(e => e.kind === 'log' && e.message.includes('to pick up when the limit resets')))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runFramework appends the resume note to an existing backlog (#529)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-pause-'))
  try {
    await writeFile(join(cwd, 'TODO.md'), '- [ ] Something already open') // no trailing newline
    await assert.rejects(
      runFramework({ intent: FAKE_INTENT, driver: fakeDriver(), cwd, signals: FAKE_SIGNALS, consumptionGate: () => 'session' }),
    )
    const todo = await readFile(join(cwd, 'TODO.md'), 'utf8')
    // The existing entry survives and the note lands on its own line.
    assert.match(todo, /- \[ \] Something already open\n- \[ \] Resume /)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runFramework carries on while the limits are clear (#529)', async () => {
  const events: FrameworkEvent[] = []
  let asked = 0
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    consumptionGate: () => {
      asked++
      return null
    },
    onEvent: e => events.push(e),
  })
  assert.ok(result)
  assert.ok(asked > 0, 'the gate is consulted between turns')
  const end = events.at(-1)!
  assert.equal(end.kind === 'end' && end.ok, true)
})

test('runFramework carries on when the gate itself fails (#529)', async () => {
  // Fail-open, per Rom on #519: an unreadable quota must not stop the work.
  const { result } = await runFramework({
    intent: FAKE_INTENT,
    driver: fakeDriver(),
    cwd: '/tmp/ws',
    signals: FAKE_SIGNALS,
    consumptionGate: () => {
      throw new Error('quota unreadable')
    },
  })
  assert.ok(result)
})

test('runFramework leaves the run ungated with no consumption gate (#529)', async () => {
  const { result } = await runFramework({ intent: FAKE_INTENT, driver: fakeDriver(), cwd: '/tmp/ws', signals: FAKE_SIGNALS })
  assert.ok(result)
})

// The await rounds shared by the direct prompt path and the backlog loop (#569). Both used
// to carry their own copy, which is how the turn-signal emission missed one of them (#563).

/** A gate the fake agent can emit, in the wire shape `parseAwaitGate` reads. */
const choicesGate = (title: string): string =>
  `${title}\n\`\`\`await-choices\n${JSON.stringify({ title, options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }] })}\n\`\`\``

const confirmGate = (title: string): string =>
  `${title}\n\`\`\`await-confirmation\n${JSON.stringify({ title })}\n\`\`\``

test('runAwaitRounds resolves a gate, re-prompts with the answer, and emits every turn signal', async () => {
  const events: FrameworkEvent[] = []
  const prompts: string[] = []
  const signalled: string[] = []
  const driver = new FakeDriver({
    respond: (prompt, i) => {
      prompts.push(prompt)
      return i === 0 ? choicesGate('Which way?') : 'All done.'
    },
  })
  const session = await driver.start({ cwd: '/tmp/ws' })
  const result = await runAwaitRounds({
    session,
    prompt: 'open',
    continuation: (gate, answer) => `resume: ${gate.title} -> ${answer}`,
    emitTurnSignals: text => void signalled.push(text),
    requestChoice: async () => ({ picked: 'b' }),
    emit: e => void events.push(e),
  })

  assert.deepEqual(result, { text: 'All done.', declined: false, exhausted: false })
  assert.deepEqual(prompts, ['open', 'resume: Which way? -> Option B']) // the caller owns the wording
  assert.ok(events.some(e => e.kind === 'log' && e.message === 'Continuing with your choice: Option B'))
  // Every turn goes through the signal emitter, the gate turn included (#563).
  assert.equal(signalled.length, 2)
  assert.match(signalled[0]!, /await-choices/)
  assert.equal(signalled[1], 'All done.')
})

test('runAwaitRounds reports a declined plan and stops instead of re-prompting (#358)', async () => {
  const events: FrameworkEvent[] = []
  const prompts: string[] = []
  const driver = new FakeDriver({ respond: prompt => (prompts.push(prompt), confirmGate('Plan ok?')) })
  const session = await driver.start({ cwd: '/tmp/ws' })
  const result = await runAwaitRounds({
    session,
    prompt: 'open',
    continuation: () => 'should never be sent',
    emitTurnSignals: () => {},
    requestChoice: async () => ({ picked: 'decline' }),
    emit: e => void events.push(e),
  })

  assert.equal(result.declined, true)
  assert.equal(result.exhausted, false)
  assert.deepEqual(prompts, ['open']) // it stopped rather than continuing
  assert.ok(events.some(e => e.kind === 'log' && e.message === PLAN_DECLINED_MESSAGE))
})

test('runAwaitRounds gives up after MAX_AWAIT_ROUNDS and reports it exhausted', async () => {
  const prompts: string[] = []
  // An agent that asks forever: the cap is what stops it.
  const driver = new FakeDriver({ respond: prompt => (prompts.push(prompt), choicesGate('Again?')) })
  const session = await driver.start({ cwd: '/tmp/ws' })
  const result = await runAwaitRounds({
    session,
    prompt: 'open',
    continuation: () => 'again',
    emitTurnSignals: () => {},
    requestChoice: async () => ({ picked: 'a' }),
    emit: () => {},
  })

  assert.equal(result.exhausted, true)
  assert.equal(result.declined, false)
  assert.equal(prompts.length, MAX_AWAIT_ROUNDS + 1) // the opener, then one per round
})
