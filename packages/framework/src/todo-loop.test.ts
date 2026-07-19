import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver } from './driver/fake.js'
import type { ChoicePick, ChoiceRequest, FrameworkEvent } from './events.js'
import { appendTodoEntry, findTodoBacklog, parseTodoEntries, runTodoLoop } from './todo-loop.js'

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'framework-todo-'))
}

test('parseTodoEntries reads open list items and skips checked/blank/prose lines', () => {
  const md = [
    '# Backlog',
    '',
    'Some prose about the backlog.',
    '- [ ] fix the login redirect',
    '- [x] already done',
    '- [X] also done',
    '- plain bullet entry',
    '* star bullet entry',
    '2. numbered entry',
    '- [ ]   ', // open checkbox with no text
    '-    ', // empty bullet
  ].join('\n')
  assert.deepEqual(parseTodoEntries(md), [
    'fix the login redirect',
    'plain bullet entry',
    'star bullet entry',
    'numbered entry',
  ])
})

test('findTodoBacklog prefers the newest session-scoped file, falls back to flat TODO.md', async () => {
  const cwd = await tmpWorkspace()
  try {
    assert.equal(await findTodoBacklog(cwd), undefined) // nothing yet

    await writeFile(join(cwd, 'TODO.md'), '- flat entry\n')
    assert.equal((await findTodoBacklog(cwd))?.name, 'TODO.md')

    // A session-scoped backlog wins over the flat one.
    await writeFile(join(cwd, 'TODO_feat-x.agent.md'), '- [ ] scoped entry\n')
    assert.deepEqual(await findTodoBacklog(cwd), { name: 'TODO_feat-x.agent.md', entries: ['scoped entry'] })

    // Two sessions: the most recently modified wins.
    await writeFile(join(cwd, 'TODO_feat-y.agent.md'), '- newer entry\n')
    const past = new Date(Date.now() - 60_000)
    await utimes(join(cwd, 'TODO_feat-x.agent.md'), past, past)
    assert.equal((await findTodoBacklog(cwd))?.name, 'TODO_feat-y.agent.md')

    // A fully checked-off scoped backlog is skipped in favor of the next candidate.
    await writeFile(join(cwd, 'TODO_feat-y.agent.md'), '- [x] all done\n')
    await writeFile(join(cwd, 'TODO_feat-x.agent.md'), '- [x] all done\n')
    assert.equal((await findTodoBacklog(cwd))?.name, 'TODO.md')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('findTodoBacklog reads the flat backlog from the root TODO_AGENTS.md (#682)', async () => {
  const cwd = await tmpWorkspace()
  try {
    await writeFile(join(cwd, 'TODO_AGENTS.md'), '- [ ] roadmap entry\n')
    assert.deepEqual(await findTodoBacklog(cwd), { name: 'TODO_AGENTS.md', entries: ['roadmap entry'] })

    // A session-scoped backlog still wins over the flat one, wherever the flat one lives.
    await writeFile(join(cwd, 'TODO_feat-x.agent.md'), '- [ ] scoped entry\n')
    assert.equal((await findTodoBacklog(cwd))?.name, 'TODO_feat-x.agent.md')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('findTodoBacklog still reads a legacy tickets/TODO.md backlog (#682 fallback)', async () => {
  const cwd = await tmpWorkspace()
  try {
    await mkdir(join(cwd, 'tickets'))
    await writeFile(join(cwd, 'tickets/TODO.md'), '- [ ] roadmap entry\n')
    assert.deepEqual(await findTodoBacklog(cwd), { name: 'tickets/TODO.md', entries: ['roadmap entry'] })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('appendTodoEntry creates the root TODO_AGENTS.md when the workspace has no backlog (#682)', async () => {
  const cwd = await tmpWorkspace()
  try {
    const file = await appendTodoEntry(cwd, 'Resume the paused run')
    assert.equal(file, 'TODO_AGENTS.md')
    assert.equal(await readFile(join(cwd, 'TODO_AGENTS.md'), 'utf8'), '- [ ] Resume the paused run\n')

    // A second entry appends to the same file, not a new one.
    await appendTodoEntry(cwd, 'And another')
    assert.equal(await readFile(join(cwd, 'TODO_AGENTS.md'), 'utf8'), '- [ ] Resume the paused run\n- [ ] And another\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runTodoLoop works the backlog to empty, one entry per turn (#323)', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO_feat-x.agent.md')
  await writeFile(file, '- [ ] first task\n- [ ] second task\n')
  try {
    const events: FrameworkEvent[] = []
    const prompts: string[] = []
    // The fake driver writes no files, so the test plays the agent's side: each
    // item turn checks its entry off before the loop re-reads the backlog.
    const driver = new FakeDriver({
      respond: (prompt, i) => {
        prompts.push(prompt)
        writeFileSync(file, i === 0 ? '- [x] first task\n- [ ] second task\n' : '- [x] first task\n- [x] second task\n')
        return `completed item ${i + 1}`
      },
    })
    const session = await driver.start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e) })

    assert.deepEqual(result, { completed: 2, reason: 'empty', file: 'TODO_feat-x.agent.md' })
    assert.equal(prompts.length, 2)
    assert.match(prompts[0]!, /TODO_feat-x\.agent\.md/)
    assert.match(prompts[0]!, /FIRST open entry only/)
    // Narrated: the opening count, each item, and the completion line.
    assert.ok(events.some(e => e.kind === 'log' && /has 2 open item\(s\)/.test(e.message)))
    assert.ok(events.some(e => e.kind === 'log' && /Backlog item 1: first task/.test(e.message)))
    assert.ok(events.some(e => e.kind === 'log' && /Backlog item 2: second task/.test(e.message)))
    assert.ok(events.some(e => e.kind === 'log' && /Backlog done/.test(e.message)))
    // Headless: no per-item gate events.
    assert.equal(events.some(e => e.kind === 'choice'), false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runTodoLoop returns empty without a backlog and emits nothing', async () => {
  const cwd = await tmpWorkspace()
  try {
    const events: FrameworkEvent[] = []
    const session = await new FakeDriver({ turns: [{ text: 'never prompted' }] }).start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e) })
    assert.deepEqual(result, { completed: 0, reason: 'empty' })
    assert.deepEqual(events, [])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('an interactive loop gates before each entry; picking stop ends it (#323)', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO.md')
  await writeFile(file, '- [ ] task a\n- [ ] task b\n')
  try {
    const events: FrameworkEvent[] = []
    const gates: ChoiceRequest[] = []
    // Accept the first gate, stop at the second.
    const requestChoice = (req: ChoiceRequest): Promise<ChoicePick> => {
      gates.push(req)
      return Promise.resolve({ picked: gates.length === 1 ? 'proceed' : 'stop', by: 'user' })
    }
    const driver = new FakeDriver({
      respond: () => {
        writeFileSync(file, '- [x] task a\n- [ ] task b\n')
        return 'did task a'
      },
    })
    const session = await driver.start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e), requestChoice })

    assert.deepEqual(result, { completed: 1, reason: 'stopped', file: 'TODO.md' })
    assert.equal(gates.length, 2)
    assert.equal(gates[0]!.id, 'todo-next')
    assert.equal(gates[1]!.id, 'todo-next-1')
    assert.match(gates[0]!.options[0]!.label, /Work on: task a/)
    assert.equal(gates[0]!.recommended, 'proceed')
    assert.ok(events.some(e => e.kind === 'log' && /stopped by you/.test(e.message)))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runTodoLoop stops after two items with no progress instead of spinning', async () => {
  const cwd = await tmpWorkspace()
  await writeFile(join(cwd, 'TODO.md'), '- [ ] stubborn task\n')
  try {
    const events: FrameworkEvent[] = []
    // The agent never touches the file, so the next entry never changes.
    const session = await new FakeDriver({ respond: () => 'did nothing' }).start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e) })
    assert.deepEqual(result, { completed: 2, reason: 'stalled', file: 'TODO.md' })
    assert.ok(events.some(e => e.kind === 'log' && /no progress on "stubborn task"/.test(e.message)))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('appended follow-up entries do not count as a stall (Maintenance pattern)', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO.md')
  await writeFile(file, '- [ ] task a\n')
  try {
    let turn = 0
    // Turn 1 retires task a but appends a follow-up; turn 2 retires the follow-up.
    const session = await new FakeDriver({
      respond: () => {
        turn++
        writeFileSync(file, turn === 1 ? '- [x] task a\n- [ ] refactor follow-up\n' : '- [x] task a\n- [x] refactor follow-up\n')
        return `turn ${turn}`
      },
    }).start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: () => {} })
    assert.deepEqual(result, { completed: 2, reason: 'empty', file: 'TODO.md' })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runTodoLoop honors the item cap and reports what is left', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO.md')
  await writeFile(file, '- [ ] a\n- [ ] b\n- [ ] c\n')
  try {
    let turn = 0
    const events: FrameworkEvent[] = []
    const session = await new FakeDriver({
      respond: () => {
        turn++
        writeFileSync(file, ['- [x] a', turn >= 2 ? '- [x] b' : '- [ ] b', '- [ ] c'].join('\n') + '\n')
        return `turn ${turn}`
      },
    }).start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e), maxItems: 2 })
    assert.deepEqual(result, { completed: 2, reason: 'max-items', file: 'TODO.md' })
    assert.ok(events.some(e => e.kind === 'log' && /2-item cap.*1 item\(s\) left/.test(e.message)))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('an item turn that stops to ask is gated and resumed like any await gate (#337)', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO.md')
  await writeFile(file, '- [ ] pick a database\n')
  const gateTurn = [
    'Which database?',
    '```await-choices',
    JSON.stringify({ title: 'Which database?', options: [{ label: 'SQLite' }, { label: 'Postgres' }], recommended: 'SQLite' }),
    '```',
  ].join('\n')
  try {
    const events: FrameworkEvent[] = []
    const prompts: string[] = []
    const session = await new FakeDriver({
      respond: (prompt, i) => {
        prompts.push(prompt)
        if (i === 0) return gateTurn // the item turn stops to ask
        writeFileSync(file, '- [x] pick a database\n')
        return 'picked and done'
      },
    }).start({ cwd })
    const requestChoice = (req: ChoiceRequest): Promise<ChoicePick> =>
      Promise.resolve({ picked: req.id.startsWith('todo-next') ? 'proceed' : 'opt:1', by: 'user' })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e), requestChoice })

    assert.deepEqual(result, { completed: 1, reason: 'empty', file: 'TODO.md' })
    assert.equal(prompts.length, 2)
    assert.match(prompts[1]!, /The user chose: Postgres/)
    const ids = events.filter(e => e.kind === 'choice').map(e => (e as { id: string }).id)
    assert.deepEqual(ids, ['todo-next', 'await-choices'])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('an aborted signal ends the loop before starting another entry', async () => {
  const cwd = await tmpWorkspace()
  await writeFile(join(cwd, 'TODO.md'), '- [ ] a\n')
  try {
    const controller = new AbortController()
    controller.abort()
    const session = await new FakeDriver({ respond: () => 'never' }).start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: () => {}, signal: controller.signal })
    // Aborted before item 1: nothing worked, reported as a clean stop.
    assert.deepEqual(result, { completed: 0, reason: 'stopped' })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a backlog turn emits its signals: views, session name, ready-for-merge', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO_feat-x.agent.md')
  await writeFile(file, '- [ ] tidy the login redirect\n')
  try {
    const events: FrameworkEvent[] = []
    // The protocols are unconditional, so the agent is told it can signal on ANY turn,
    // a backlog turn included. Everything it emits has to reach the run stream.
    const driver = new FakeDriver({
      respond: () => {
        writeFileSync(file, '- [x] tidy the login redirect\n')
        return [
          'Done.',
          '```show-markdown',
          '# What I changed',
          'Rewrote the redirect guard.',
          '```',
          '```set-session-name',
          'login-redirect-fix',
          '```',
          '```ready-for-merge',
          '```',
        ].join('\n')
      },
    })
    const session = await driver.start({ cwd })
    await runTodoLoop({ session, cwd, emit: e => events.push(e) })

    const view = events.find(e => e.kind === 'view')
    assert.equal(view?.title, 'What I changed')
    assert.equal(events.find(e => e.kind === 'session-name')?.name, 'login-redirect-fix')
    assert.equal(events.filter(e => e.kind === 'ready-for-merge').length, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('ready-for-merge is emitted once across a multi-item backlog', async () => {
  const cwd = await tmpWorkspace()
  const file = join(cwd, 'TODO_feat-x.agent.md')
  await writeFile(file, '- [ ] first task\n- [ ] second task\n')
  try {
    const events: FrameworkEvent[] = []
    // Both items signal ready-for-merge; the loop's one emitter dedupes them.
    const driver = new FakeDriver({
      respond: (_prompt, i) => {
        writeFileSync(file, i === 0 ? '- [x] first task\n- [ ] second task\n' : '- [x] first task\n- [x] second task\n')
        return 'Done.\n```ready-for-merge\n```'
      },
    })
    const session = await driver.start({ cwd })
    const result = await runTodoLoop({ session, cwd, emit: e => events.push(e) })

    assert.equal(result.completed, 2)
    assert.equal(events.filter(e => e.kind === 'ready-for-merge').length, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
