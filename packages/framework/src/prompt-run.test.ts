import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FakeDriver } from './driver/fake.js'
import type { Driver, DriverSession, DriverStartOptions } from './driver/types.js'
import type { ChoicePick, ChoiceRequest, FrameworkEvent } from './events.js'
import { runPrompt } from './prompt-run.js'
import { RunMessageQueue } from './run-messages.js'

const multiGateTurn = [
  'I rated the problems and wrote REVIEW-PROBLEMS_feat-x.agent.md.',
  '```await-multiselect',
  JSON.stringify({
    title: 'Which problems should get a deep-dive?',
    options: [
      { label: 'Auth session refresh', detail: 'rated 2/10', default: true },
      { label: 'CSV export', detail: 'rated 9/10' },
    ],
  }),
  '```',
].join('\n')

test('runPrompt runs a gateless prompt straight through and emits session + end', async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'all done' }] })
  const { text } = await runPrompt({
    prompt: 'do the thing',
    driver,
    cwd: '/ws',
    onEvent: e => events.push(e),
  })
  assert.equal(text, 'all done')
  assert.equal(events[0]!.kind, 'session')
  assert.equal(events.at(-1)!.kind, 'end')
  assert.deepEqual(events.at(-1), { kind: 'end', ok: true })
  // No gate, so nothing paused.
  assert.equal(events.some(e => e.kind === 'choice'), false)
})

test('runPrompt seeds the driver and resumes the opening prompt for a finished-run session (#720)', async () => {
  let startOpts: DriverStartOptions | undefined
  let openingResume: boolean | undefined
  let openingText: string | undefined
  // A capturing driver: the fake records prompt text but not its options, and we need to see the
  // start seed + the opening prompt's `resume` flag — the whole point of the auto-resume path.
  const driver: Driver = {
    name: 'capture',
    start(opts) {
      startOpts = opts
      let first = true
      const session: DriverSession = {
        id: 'x',
        cwd: opts.cwd,
        prompt(text, o = {}) {
          if (first) {
            first = false
            openingResume = o.resume
            openingText = text
          }
          return Promise.resolve({ text: 'continued', sessionId: 'sess-42' })
        },
        dispose: () => Promise.resolve(),
      }
      return Promise.resolve(session)
    },
  }
  const { text } = await runPrompt({ prompt: 'keep going', driver, cwd: '/ws', resumeSessionId: 'sess-42', onEvent: () => {} })
  assert.equal(text, 'continued')
  assert.equal(startOpts?.resumeSessionId, 'sess-42') // the session is seeded with the finished run's id
  assert.equal(openingResume, true) // the opening message --resumes it
  assert.equal(openingText, 'keep going') // sent raw: the resumed transcript already carries its framing
})

test('runPrompt stays open for a live-chat message and delivers it as a turn (#714)', async () => {
  const events: FrameworkEvent[] = []
  // Queue a message and close: the opening prompt settles, the chat phase drains the message
  // (one more turn), then next() -> undefined ends the run. Deterministic, no timing race.
  const messages = new RunMessageQueue()
  messages.push('also add dark mode')
  messages.close()
  const driver = new FakeDriver({ turns: [{ text: 'built the base' }, { text: 'added dark mode' }] })
  const { text } = await runPrompt({
    prompt: 'build it',
    driver,
    cwd: '/ws',
    messages,
    onEvent: e => events.push(e),
  })
  // The final turn is the chat reply, not the opening turn.
  assert.equal(text, 'added dark mode')
  // The message rode a driver `start` event (so it shows in the feed) and was echoed as a log.
  assert.ok(
    events.some(e => e.kind === 'driver' && e.event.type === 'start' && e.event.prompt === 'also add dark mode'),
    'the chat message was delivered as a driver turn',
  )
  assert.ok(events.some(e => e.kind === 'log' && e.message === 'You: also add dark mode'))
  assert.deepEqual(events.at(-1), { kind: 'end', ok: true })
})

test('runPrompt without a messages source ends when the agent stops (byte-identical, #714)', async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'done' }] })
  const { text } = await runPrompt({ prompt: 'go', driver, cwd: '/ws', onEvent: e => events.push(e) })
  assert.equal(text, 'done')
  assert.deepEqual(events.at(-1), { kind: 'end', ok: true })
})

test('runPrompt emits the #326 lifecycle signals a turn declares (session name, ready-for-merge)', async () => {
  const events: FrameworkEvent[] = []
  const turn = [
    'Set up the branch and finished the work.',
    '```set-session-name',
    'Add Comments!',
    '```',
    '```ready-for-merge',
    '```',
  ].join('\n')
  const driver = new FakeDriver({ turns: [{ text: turn }] })
  await runPrompt({ prompt: 'add comments', driver, cwd: '/ws', onEvent: e => events.push(e) })
  assert.deepEqual(
    events.find(e => e.kind === 'session-name'),
    { kind: 'session-name', name: 'add-comments' }, // slugified to the branch shape
  )
  assert.ok(
    events.some(e => e.kind === 'ready-for-merge'),
    'a ready-for-merge event is emitted',
  )
})

test('runPrompt surfaces the system prompt (#343); the user prompt rides a driver start event', async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'done' }] })
  const startSpy = driver.start.bind(driver)
  let captured = ''
  driver.start = async opts => {
    captured = opts.system ?? ''
    return startSpy(opts)
  }

  await runPrompt({ prompt: 'refactor the auth flow', driver, cwd: '/ws', onEvent: e => events.push(e) })

  // The system prompt is emitted verbatim: exactly what the driver was started with.
  const sys = events.find(e => e.kind === 'system-prompt')
  assert.ok(sys, 'a system-prompt event is emitted')
  assert.equal((sys as { text: string }).text, captured)
  assert.match((sys as { text: string }).text, /# System prompt/) // the built-in #326 block
  // The user prompt is observable too, carried by the driver start event.
  const start = events.find(
    (e): e is Extract<FrameworkEvent, { kind: 'driver' }> => e.kind === 'driver' && e.event.type === 'start',
  )
  assert.ok(start, 'the driver start event carries the user prompt')
  if (start.event.type === 'start') assert.match(start.event.prompt, /refactor the auth flow/)
})

test('runPrompt honors eco flags in the emitted system prompt (#314)', async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'done' }] })
  await runPrompt({
    prompt: 'tidy the code',
    driver,
    cwd: '/ws',
    onEvent: e => events.push(e),
    eco: { autoResearch: true, autoMaintenance: true },
  })
  const sys = events.find(e => e.kind === 'system-prompt') as { text: string } | undefined
  assert.ok(sys)
  // The dropped section is gone; the surviving one stays. autoMaintenance drops nothing
  // since #326 moved that section to the on-before-mergeable prompt (#556).
  assert.ok(!sys.text.includes('### Alternatives'))
  assert.ok(sys.text.includes('### Scope'))
})

test('runPrompt with antiLazyPill false emits no built-in prompt even with eco set (#314)', async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'done' }] })
  await runPrompt({
    prompt: 'raw run',
    driver,
    cwd: '/ws',
    onEvent: e => events.push(e),
    antiLazyPill: false,
    eco: { autoPlanning: true },
  })
  const sys = events.find(e => e.kind === 'system-prompt') as { text: string } | undefined
  assert.ok(sys)
  // Vanilla: no #326 block at all, only the always-on await protocol.
  assert.ok(!sys.text.includes('# System prompt'))
  assert.ok(!sys.text.includes('## Analyze the user prompt'))
})

test('runPrompt under transparent emits an empty system channel and sends the prompt verbatim (#625)', async () => {
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'done' }] })
  await runPrompt({
    prompt: 'just do this',
    driver,
    cwd: '/ws',
    onEvent: e => events.push(e),
    transparent: true,
  })
  const sys = events.find(e => e.kind === 'system-prompt') as { text: string } | undefined
  assert.ok(sys)
  assert.equal(sys.text, '') // no framework system channel at all — not even the emit protocols
  const start = events.find(
    (e): e is Extract<FrameworkEvent, { kind: 'driver' }> => e.kind === 'driver' && e.event.type === 'start',
  )
  assert.ok(start, 'the driver start event carries the user prompt')
  if (start.event.type === 'start') assert.equal(start.event.prompt, 'just do this') // verbatim, not the template half
})

test('runPrompt pauses on a multi-select gate and continues with the pick (#331)', async () => {
  const events: FrameworkEvent[] = []
  const picks: ChoiceRequest[] = []
  const requestChoice = (req: ChoiceRequest): Promise<ChoicePick> => {
    picks.push(req)
    return Promise.resolve({ picked: ['opt:0'], by: 'user' })
  }

  const driver = new FakeDriver({ turns: [{ text: multiGateTurn }, { text: 'TODO entries written.' }] })
  const startSpy = driver.start.bind(driver)
  let prompts: string[] = []
  driver.start = async opts => {
    const s = await startSpy(opts)
    prompts = s.prompts
    return s
  }

  const { text } = await runPrompt({
    prompt: 'measure problem variability of this PR',
    driver,
    cwd: '/ws',
    onEvent: e => events.push(e),
    requestChoice,
  })

  // The gate was shown with the low-rated problem pre-checked, and resolved.
  assert.equal(picks.length, 1)
  assert.equal(picks[0]!.multi, true)
  assert.equal(picks[0]!.id, 'await-multiselect')
  assert.equal(picks[0]!.options[0]!.default, true)
  const choice = events.find(e => e.kind === 'choice')
  assert.ok(choice, 'choice event emitted for the dashboard')
  const resolved = events.find(e => e.kind === 'choice-resolved')
  assert.deepEqual(resolved, { kind: 'choice-resolved', id: 'await-multiselect', picked: ['opt:0'], by: 'user' })

  // The driver was re-prompted with the answer and finished on the second turn.
  assert.equal(prompts.length, 2)
  assert.match(prompts[1]!, /The user chose: Auth session refresh/)
  assert.equal(text, 'TODO entries written.')
  assert.deepEqual(events.at(-1), { kind: 'end', ok: true })
})

test('a headless runPrompt still resolves the gate to its defaults and continues', async () => {
  // Unlike a build's agentAwaitGate (which returns as-is headless), the direct
  // path must complete the prompt's post-gate steps, so it auto-accepts defaults.
  const events: FrameworkEvent[] = []
  let prompts: string[] = []
  const driver = new FakeDriver({ turns: [{ text: multiGateTurn }, { text: 'done' }] })
  const startSpy = driver.start.bind(driver)
  driver.start = async opts => {
    const s = await startSpy(opts)
    prompts = s.prompts
    return s
  }
  const { text } = await runPrompt({ prompt: 'research', driver, cwd: '/ws', onEvent: e => events.push(e) })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1]!, /The user chose: Auth session refresh/) // the default-checked option
  assert.equal(text, 'done')
  const resolved = events.find(e => e.kind === 'choice-resolved')
  assert.deepEqual(resolved, { kind: 'choice-resolved', id: 'await-multiselect', picked: ['opt:0'], by: 'auto' })
})

test('runPrompt honors a single-select gate with the recommended fallback id scheme', async () => {
  const singleGateTurn = [
    'Question first.',
    '```await-choices',
    JSON.stringify({ title: 'Proceed how?', options: [{ label: 'Fast' }, { label: 'Careful' }], recommended: 'Careful' }),
    '```',
  ].join('\n')
  const events: FrameworkEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: singleGateTurn }, { text: 'ok' }] })
  const requestChoice = (req: ChoiceRequest): Promise<ChoicePick> =>
    Promise.resolve({ picked: req.recommended ?? '', by: 'user' })
  const { text } = await runPrompt({ prompt: 'go', driver, cwd: '/ws', onEvent: e => events.push(e), requestChoice })
  assert.equal(text, 'ok')
  const resolved = events.find(e => e.kind === 'choice-resolved')
  assert.deepEqual(resolved, { kind: 'choice-resolved', id: 'await-choices', picked: 'opt:1', by: 'user' })
})

test('runPrompt stops re-asking after the await limit instead of looping forever', async () => {
  const events: FrameworkEvent[] = []
  // Every turn ends on a gate; the run must finish after the bounded rounds.
  const driver = new FakeDriver({ respond: () => multiGateTurn })
  const { text } = await runPrompt({ prompt: 'ask forever', driver, cwd: '/ws', onEvent: e => events.push(e) })
  assert.equal(text, multiGateTurn)
  const limit = events.find(e => e.kind === 'log' && /await limit reached/.test(e.message))
  assert.ok(limit, 'the limit is narrated')
  assert.deepEqual(events.at(-1), { kind: 'end', ok: true })
  // Rounds after the first get unique gate ids.
  const ids = events.filter(e => e.kind === 'choice').map(e => (e as { id: string }).id)
  assert.deepEqual(ids.slice(0, 2), ['await-multiselect', 'await-multiselect-1'])
})

test('an aborted runPrompt emits a stopped end and rethrows', async () => {
  const events: FrameworkEvent[] = []
  const controller = new AbortController()
  controller.abort()
  const driver = new FakeDriver({ turns: [{ text: 'never' }] })
  await assert.rejects(() =>
    runPrompt({ prompt: 'go', driver, cwd: '/ws', signal: controller.signal, onEvent: e => events.push(e) }),
  )
  const end = events.at(-1)
  assert.equal(end!.kind, 'end')
  assert.deepEqual(end, { kind: 'end', ok: false, stopped: true, detail: '[framework] fake prompt aborted' })
})

test('runPrompt stops itself at the budget cap and reports a clean stop (#322)', async () => {
  const events: FrameworkEvent[] = []
  const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 }
  // Turn 1 spends past the cap and ends on a gate, so the run tries a turn 2.
  const driver = new FakeDriver({ turns: [{ text: multiGateTurn, usage }, { text: 'never', usage }] })
  await assert.rejects(() =>
    runPrompt({ prompt: 'go', driver, cwd: '/ws', budgetUsd: 0.5, onEvent: e => events.push(e) }),
  )
  const end = events.at(-1) as { kind: string; ok: boolean; stopped?: boolean; detail?: string }
  assert.equal(end.kind, 'end')
  assert.equal(end.ok, false)
  assert.equal(end.stopped, true)
  assert.match(end.detail ?? '', /budget reached/)
})

test('runPrompt cannot cap an agent that reports no price, and says so in tokens (#540)', async () => {
  const events: FrameworkEvent[] = []
  // Codex's shape: tokens, no costUsd. Same script as the cap test above, so the
  // only difference is the missing price.
  const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 }
  const driver = new FakeDriver({ turns: [{ text: multiGateTurn, usage }, { text: 'second turn ran', usage }] })
  const { text } = await runPrompt({ prompt: 'go', driver, cwd: '/ws', budgetUsd: 0.5, onEvent: e => events.push(e) })
  // The cap never fires: there is no price to compare against it.
  assert.equal(text, 'second turn ran')
  assert.equal(events.some(e => e.kind === 'log' && e.message.startsWith('Budget reached:')), false)
  // The tokens are still metered and reported, which is the point of #540.
  const usageEvents = events.filter(e => e.kind === 'usage')
  assert.equal(usageEvents.length, 2)
  const last = usageEvents.at(-1)!
  assert.equal(last.kind === 'usage' && last.costUsd, undefined)
  assert.equal(last.kind === 'usage' && last.inputTokens, 20)
  assert.equal(last.kind === 'usage' && last.turns, 2)
})

test('runPrompt pauses at a consumption limit and reports a clean stop (#531)', async () => {
  const events: FrameworkEvent[] = []
  const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01 }
  // Turn 1 ends on a gate, so the run would otherwise take a turn 2.
  const driver = new FakeDriver({ turns: [{ text: multiGateTurn, usage }, { text: 'never', usage }] })
  await assert.rejects(() =>
    runPrompt({ prompt: 'go', driver, cwd: '/ws', consumptionGate: () => 'daily', onEvent: e => events.push(e) }),
  )
  // The direct prompt path is its own loop, so it needs the gate in its own right.
  const end = events.at(-1) as { kind: string; ok: boolean; stopped?: boolean; detail?: string }
  assert.equal(end.kind, 'end')
  assert.equal(end.stopped, true)
  assert.match(end.detail ?? '', /Daily consumption limit reached/)
  assert.ok(events.some(e => e.kind === 'log' && e.message === 'Daily consumption limit reached — pausing the run.'))
})

test('runPrompt carries on when the consumption gate fails (#531)', async () => {
  // Fail-open, per Rom on #519.
  const driver = new FakeDriver({ turns: [{ text: 'done' }] })
  const { text } = await runPrompt({
    prompt: 'go',
    driver,
    cwd: '/ws',
    consumptionGate: () => {
      throw new Error('quota unreadable')
    },
  })
  assert.equal(text, 'done')
})
