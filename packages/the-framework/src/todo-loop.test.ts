import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver } from './driver/fake.js'
import type { ChoicePick, ChoiceRequest, FrameworkEvent } from './events.js'
import { appendTodoEntry, appendFlatTodoEntry, findTodoBacklog, insertTodoEntry, nextQueuedTicket, parseTodoEntries, runTodoLoop, sessionTodoPending, ticketForPrompt } from './todo-loop.js'
import { drainsQueue, presets } from './preset-catalog.js'
import { AUTO_PM_DRAIN_JOB, AUTO_PM_JOBS } from './auto-pm.js'

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

test('the #880 priority sections need no parser support: headings are skipped, so a sorted file drains in priority order', () => {
  const md = [
    '## Priority 10 (critical — act immediately)',
    '- restore checkout',
    '',
    '## Priority 9',
    '- flaky auth test',
    '',
    '## Priority 5',
    '- tidy the config loader',
    '',
    '## Priority 0 (only if capacity)',
    '- rename the legacy flag',
  ].join('\n')
  assert.deepEqual(parseTodoEntries(md), [
    'restore checkout',
    'flaky auth test',
    'tidy the config loader',
    'rename the legacy flag',
  ])
})

test('findTodoBacklog reads the flat backlog and falls back to a flat TODO.md', async () => {
  const cwd = await tmpWorkspace()
  try {
    assert.equal(await findTodoBacklog(cwd), undefined) // nothing yet

    await writeFile(join(cwd, 'TODO.md'), '- flat entry\n')
    assert.equal((await findTodoBacklog(cwd))?.name, 'TODO.md')

    // A fully checked-off backlog is no backlog.
    await writeFile(join(cwd, 'TODO.md'), '- [x] all done\n')
    assert.equal(await findTodoBacklog(cwd), undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('findTodoBacklog reads the flat backlog from the root TODO_AGENTS.md (#682)', async () => {
  const cwd = await tmpWorkspace()
  try {
    await writeFile(join(cwd, 'TODO_AGENTS.md'), '- [ ] roadmap entry\n')
    assert.deepEqual(await findTodoBacklog(cwd), { name: 'TODO_AGENTS.md', entries: ['roadmap entry'] })

    // The retired session-scoped backlog (#1369) is ignored, even when it has open entries.
    await writeFile(join(cwd, 'TODO_feat-x.agent.md'), '- [ ] scoped entry\n')
    assert.equal((await findTodoBacklog(cwd))?.name, 'TODO_AGENTS.md')
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
  const file = join(cwd, 'TODO_AGENTS.md')
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

    assert.deepEqual(result, { completed: 2, reason: 'empty', file: 'TODO_AGENTS.md' })
    assert.equal(prompts.length, 2)
    assert.match(prompts[0]!, /TODO_AGENTS\.md/)
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
  const file = join(cwd, 'TODO_AGENTS.md')
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
  const file = join(cwd, 'TODO_AGENTS.md')
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

// #697/#1369: everything lands on the project's flat queue — a leftover session-scoped
// backlog in the checkout is retired and never written to. Only the flat file is carried
// between branches by promoteQueue (#852), so an entry elsewhere could vanish unseen.
test('both append helpers write the flat queue even when a session backlog exists (#697/#1369)', async () => {
  const cwd = await tmpWorkspace()
  try {
    await writeFile(join(cwd, 'TODO_a-session.agent.md'), '- [ ] a run\n', 'utf8')

    assert.equal(await appendTodoEntry(cwd, 'from the run'), 'TODO_AGENTS.md')
    assert.equal(await appendFlatTodoEntry(cwd, 'Do ticket 42'), 'TODO_AGENTS.md')
    assert.equal(await readFile(join(cwd, 'TODO_AGENTS.md'), 'utf8'), '- [ ] from the run\n- [ ] Do ticket 42\n')
    // The leftover session file is untouched.
    assert.equal(await readFile(join(cwd, 'TODO_a-session.agent.md'), 'utf8'), '- [ ] a run\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

// The queue is worked front to back (the drain preset takes "the FIRST open entry" and
// parseTodoEntries reads in file order), so where an entry lands *is* its priority. Appending at
// the end, which is what queueing a ticket used to do, meant "work on this" put it last (#1164).

test('a queued entry lands in its own priority section, not at the end of the file (#1164)', () => {
  const md = ['# Backlog', '', '## Priority 7', '', '- [ ] an important thing', '', '## Priority 2', '', '- [ ] someday', ''].join('\n')
  const out = insertTodoEntry(md, 'a medium thing', 5)
  assert.match(out, /## Priority 5\n\n- \[ \] a medium thing/)
  // Between the two it ranks against, and ahead of the low one it outranks.
  assert.ok(out.indexOf('an important thing') < out.indexOf('a medium thing'))
  assert.ok(out.indexOf('a medium thing') < out.indexOf('someday'))
})

test('an entry joins the section it belongs to when there already is one (#1164)', () => {
  const md = ['## Priority 5', '', '- [ ] first', '', '## Priority 2', '', '- [ ] later', ''].join('\n')
  const out = insertTodoEntry(md, 'second', 5)
  assert.match(out, /- \[ \] first\n- \[ \] second/)
  // One section, not a duplicate heading.
  assert.equal(out.match(/## Priority 5/g)?.length, 1)
})

test('a file with no priority sections gets one above its own headings (#1164)', () => {
  // The file's sections are unranked, so burying a deliberate pick beneath them is the bug.
  const md = ['# Backlog', '', 'Some prose.', '', '## MVP v1', '', '- [ ] dogfooding', ''].join('\n')
  const out = insertTodoEntry(md, 'queued thing', 5)
  assert.ok(out.indexOf('queued thing') < out.indexOf('dogfooding'))
  assert.ok(out.startsWith('# Backlog\n\nSome prose.\n'), 'the intro stays at the top')
  assert.deepEqual(parseTodoEntries(out), ['queued thing', 'dogfooding'])
})

test('a backlog with nothing but prose still gets a section (#1164)', () => {
  const out = insertTodoEntry('# Backlog\n\nSome prose.\n', 'queued thing', 5)
  assert.match(out, /## Priority 5\n\n- \[ \] queued thing\n$/)
})

test('an entry that outranks everything in the file goes first (#1164)', () => {
  const md = ['## Priority 2', '', '- [ ] someday', ''].join('\n')
  const out = insertTodoEntry(md, 'urgent thing', 9)
  assert.ok(out.indexOf('urgent thing') < out.indexOf('someday'))
})

test('an entry outranked by everything in the file goes last, in its own section (#1164)', () => {
  const md = ['## Priority 9', '', '- [ ] urgent thing', ''].join('\n')
  const out = insertTodoEntry(md, 'someday', 2)
  assert.ok(out.indexOf('urgent thing') < out.indexOf('someday'))
  assert.match(out, /## Priority 2\n\n- \[ \] someday/)
})

test('a section heading with the format\'s own gloss is still matched (#1164)', () => {
  // `todo_format.md` writes "## Priority 10 (critical — act immediately)".
  const md = ['## Priority 10 (critical)', '', '- [ ] the fire', ''].join('\n')
  const out = insertTodoEntry(md, 'another fire', 10)
  assert.equal(out.match(/## Priority 10/g)?.length, 1)
  assert.match(out, /- \[ \] the fire\n- \[ \] another fire/)
})

test('appendFlatTodoEntry places by priority when given one, and appends when not (#1164)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'todo-priority-'))
  try {
    await writeFile(join(dir, 'TODO_AGENTS.md'), '# Backlog\n\n## MVP v1\n\n- [ ] old\n', 'utf8')
    await appendFlatTodoEntry(dir, 'ranked', 5)
    await appendFlatTodoEntry(dir, 'unranked')
    const md = await readFile(join(dir, 'TODO_AGENTS.md'), 'utf8')
    // The ranked one jumped the unranked backlog; the plain append stayed an append.
    assert.deepEqual(parseTodoEntries(md), ['ranked', 'old', 'unranked'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('nextQueuedTicket names the ticket the next drain run will pick up (#1117)', async () => {
  const cwd = await tmpWorkspace()
  try {
    // Nothing queued at all: nothing to name.
    assert.equal(await nextQueuedTicket(cwd), undefined)

    // The drain preset works "the FIRST open entry only", so that is the entry this reads --
    // priority order is already the file order the queue is written in (#1164).
    await writeFile(
      join(cwd, 'TODO_AGENTS.md'),
      [
        '## Priority 9',
        '',
        '- [x] [Already done](tickets/2026-07-01_done.md)',
        '- [ ] [Add a login page](tickets/2026-07-25_login.md)',
        '',
        '## Priority 5',
        '',
        '- [ ] [Later](tickets/2026-07-26_later.md)',
        '',
      ].join('\n'),
    )
    assert.equal(await nextQueuedTicket(cwd), 'tickets/2026-07-25_login.md')

    // A queue whose first open entry is plain text: a drain run there implements no ticket, and
    // saying "the one below it" would label the wrong ticket as being worked.
    await writeFile(join(cwd, 'TODO_AGENTS.md'), '- [ ] tidy the README\n- [ ] [Login](tickets/2026-07-25_login.md)\n')
    assert.equal(await nextQueuedTicket(cwd), undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('ticketForPrompt names a ticket for a hand-fired drain, and for nothing else (#1117)', async () => {
  const cwd = await tmpWorkspace()
  try {
    await writeFile(
      join(cwd, 'TODO_AGENTS.md'),
      ['## Priority 9', '', '- [ ] [Add a login page](tickets/2026-07-25_login.md)', ''].join('\n'),
    )

    // The drain preset, whatever its current wording: the sweep's own prompt, arriving by hand.
    assert.equal(await ticketForPrompt(presets.drainQueue.render(), cwd), 'tickets/2026-07-25_login.md')
    // Leading/trailing whitespace is what a textarea adds, not a different instruction.
    assert.equal(await ticketForPrompt(`\n${presets.drainQueue.render()}  `, cwd), 'tickets/2026-07-25_login.md')

    // Every other prompt implements whatever it likes; naming the queue's next entry for it would
    // put a ticket in the in-progress lane on the strength of an unrelated run.
    assert.equal(await ticketForPrompt('Work on the queue please', cwd), undefined)
    assert.equal(await ticketForPrompt(presets.spikeAndPlan.render(), cwd), undefined)
    assert.equal(await ticketForPrompt('', cwd), undefined)

    // A read that throws is a lane label, not a run: it must never take the start down with it.
    const boom = async () => {
      throw new Error('unreadable queue')
    }
    assert.equal(await ticketForPrompt(presets.drainQueue.render(), cwd, boom), undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the drain the sweep fires and the drain a click fires are the same drain (#1117)', () => {
  // The daemon recognises its drain by the `drains` flag on the job; a click has only the text.
  // If those two ever name different prompts, a hand-fired drain silently stops tagging tickets,
  // which shows up as an empty lane rather than as an error.
  assert.equal(AUTO_PM_DRAIN_JOB.drains, true)
  assert.equal(drainsQueue(AUTO_PM_DRAIN_JOB.prompt), true)
  // And nothing that merely puts work ON the queue counts as taking it off.
  for (const job of AUTO_PM_JOBS) assert.equal(drainsQueue(job.prompt), false, `${job.name} is not a drain`)
})

test('sessionTodoPending reads only the session-named TODO file (#1363)', async () => {
  const cwd = await tmpWorkspace()
  try {
    // No file: no pendingness known. The global queue must not count — it is decoupled from
    // sessions (#1390), and counting it would mean auto-merge never fires while any backlog exists.
    await writeFile(join(cwd, 'TODO_AGENTS.md'), '- [ ] a standing project entry\n')
    assert.equal(await sessionTodoPending(cwd, 'fix-login'), false)

    // The session's own file with an open entry withholds; all-checked releases.
    await writeFile(join(cwd, 'TODO_fix-login.agent.md'), '- [x] done part\n- [ ] open part\n')
    assert.equal(await sessionTodoPending(cwd, 'fix-login'), true)
    await writeFile(join(cwd, 'TODO_fix-login.agent.md'), '- [x] done part\n- [x] open part\n')
    assert.equal(await sessionTodoPending(cwd, 'fix-login'), false)

    // No session name, or one that cannot name a file, knows of nothing pending.
    assert.equal(await sessionTodoPending(cwd, undefined), false)
    assert.equal(await sessionTodoPending(cwd, '../escape'), false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
