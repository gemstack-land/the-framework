import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTickets, hasTickets } from './tickets.js'

async function repo(files: Record<string, string> = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tf-tickets-'))
  if (Object.keys(files).length) await mkdir(join(cwd, 'tickets'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(cwd, 'tickets', name), content, 'utf8')
  }
  return cwd
}

test('readTickets is empty when the repo has no tickets directory (#697)', async () => {
  assert.deepEqual(await readTickets(await repo()), [])
})

test('readTickets reads the format: keys above the title, then the TLDR (#697)', async () => {
  const cwd = await repo({
    '2026-07-20_do-the-thing.md': [
      'priority: high',
      'topics: [dx]',
      '',
      '# Do the thing',
      '',
      '## TLDR',
      '',
      'The thing is not done.',
      '',
      '## Why it matters',
      '',
      'Because.',
    ].join('\n'),
  })
  assert.deepEqual(await readTickets(cwd), [
    {
      file: '2026-07-20_do-the-thing.md',
      title: 'Do the thing',
      summary: 'The thing is not done.',
      priority: 'high',
      spiked: false,
      planned: false,
    },
  ])
})

// The tickets already in a repo are GitHub imports that predate the format, so nothing about
// the format may be required to list one.
test('readTickets still lists a ticket written before the format (#697)', async () => {
  const cwd = await repo({
    '629-New_root_directory.md': '# New root directory\n\nThe root is crowded.\n\n---\nSource: https://example.com/1\n',
  })
  const [ticket] = await readTickets(cwd)
  assert.equal(ticket?.title, 'New root directory')
  assert.equal(ticket?.summary, 'The root is crowded.')
  assert.equal(ticket?.priority, undefined)
})

test('readTickets falls back to the filename when there is no heading (#697)', async () => {
  const cwd = await repo({ '2026-07-20_no_heading.md': 'just prose\n' })
  const [ticket] = await readTickets(cwd)
  assert.equal(ticket?.title, '2026-07-20 no heading')
})

test('readTickets decodes an escaped filename rather than throwing on a stray % (#697)', async () => {
  const cwd = await repo({ '1-100%_sure.md': 'prose\n', '2-a%20b.md': 'prose\n' })
  const titles = (await readTickets(cwd)).map(t => t.title)
  assert.deepEqual(titles, ['1-100% sure', '2-a b'])
})

// A spike or a plan is written *about* a ticket, so it marks that ticket instead of becoming
// a row of its own -- otherwise planning a ticket would appear to duplicate it.
test('readTickets folds .spike.md and .plan.md into their ticket (#697)', async () => {
  const cwd = await repo({
    '2026-07-20_thing.md': '# Thing\n\nprose\n',
    '2026-07-20_thing.spike.md': '# [Spike] Thing\n',
    '2026-07-20_thing.plan.md': '# [Plan] Thing\n',
    '2026-07-21_other.md': '# Other\n\nprose\n',
  })
  const tickets = await readTickets(cwd)
  assert.deepEqual(
    tickets.map(t => [t.file, t.spiked, t.planned]),
    [
      ['2026-07-20_thing.md', true, true],
      ['2026-07-21_other.md', false, false],
    ],
  )
})

test('readTickets ignores non-markdown files (#697)', async () => {
  const cwd = await repo({ '2026-07-20_thing.md': '# Thing\n', 'notes.txt': 'nope' })
  assert.deepEqual((await readTickets(cwd)).map(t => t.file), ['2026-07-20_thing.md'])
})

test('hasTickets is false with no tickets directory, true with a ticket (#958)', async () => {
  assert.equal(await hasTickets(await repo()), false)
  assert.equal(await hasTickets(await repo({ '2026-07-20_thing.md': '# Thing\n' })), true)
})

test('hasTickets agrees with readTickets: a lone spike or plan is not a ticket (#958)', async () => {
  // The onboarding step asks whether `tickets/` is populated; a `.plan.md` with no ticket beside
  // it is written *about* a ticket, so answering yes there would tick the step off nothing.
  const cwd = await repo({ '2026-07-20_thing.plan.md': '# Plan\n', '2026-07-20_thing.spike.md': '# Spike\n' })
  assert.equal(await hasTickets(cwd), false)
  assert.deepEqual(await readTickets(cwd), [])
})

test('hasTickets ignores non-markdown files, like readTickets (#958)', async () => {
  assert.equal(await hasTickets(await repo({ 'notes.txt': 'nope' })), false)
})
