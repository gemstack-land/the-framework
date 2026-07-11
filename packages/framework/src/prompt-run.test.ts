import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FakeDriver } from './driver/fake.js'
import type { ChoicePick, ChoiceRequest, FrameworkEvent } from './events.js'
import { runPrompt } from './prompt-run.js'

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
