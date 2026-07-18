import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FLAT_TODO_FILE,
  LEGACY_TICKETS_TODO_FILE,
  LEGACY_TODO_FILE,
  TICKETS_DIR,
  TICKETING_FORMAT_FILE,
  findFlatTodo,
  materializeTicketingFormat,
} from './tickets.js'
import { TICKETING_FORMAT } from './prompts.generated.js'

test('the flat backlog lives at the root TODO-AGENTS.md, with the legacy locations named (#682)', () => {
  assert.equal(TICKETS_DIR, 'tickets')
  assert.equal(FLAT_TODO_FILE, 'TODO-AGENTS.md')
  assert.equal(LEGACY_TICKETS_TODO_FILE, 'tickets/TODO.md')
  assert.equal(LEGACY_TODO_FILE, 'TODO.md')
})

test('the ticket-format spec materializes under .the-framework, not tickets/ (#684)', async () => {
  // It is framework-authored, so it lives beside the presets and never masquerades as a ticket.
  assert.equal(TICKETING_FORMAT_FILE, '.the-framework/ticketing-format.md')

  const cwd = await mkdtemp(join(tmpdir(), 'framework-ticket-format-'))
  try {
    await materializeTicketingFormat(cwd)
    const written = await readFile(join(cwd, TICKETING_FORMAT_FILE), 'utf8')
    assert.equal(written, TICKETING_FORMAT)
    // The spec teaches both the ticket and spike file shapes.
    assert.ok(written.includes('tickets/<DATE>_<SLUG>.md'))
    assert.ok(written.includes('tickets/<DATE>_<SLUG>.spike.md'))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('findFlatTodo prefers TODO-AGENTS.md, then legacy tickets/TODO.md, then root TODO.md, else undefined (#682)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-tickets-'))
  try {
    assert.equal(await findFlatTodo(cwd), undefined)

    // Only a pre-#629 root TODO.md -> that is returned (oldest repos keep their backlog).
    await writeFile(join(cwd, 'TODO.md'), '- [ ] oldest\n')
    assert.equal(await findFlatTodo(cwd), 'TODO.md')

    // A #629 tickets/TODO.md wins over the pre-#629 root file.
    await mkdir(join(cwd, TICKETS_DIR))
    await writeFile(join(cwd, LEGACY_TICKETS_TODO_FILE), '- [ ] newer\n')
    assert.equal(await findFlatTodo(cwd), 'tickets/TODO.md')

    // The #682 root TODO-AGENTS.md wins over both legacy locations.
    await writeFile(join(cwd, FLAT_TODO_FILE), '- [ ] current\n')
    assert.equal(await findFlatTodo(cwd), 'TODO-AGENTS.md')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('findFlatTodo ignores a tickets/ directory that is not a file', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-tickets-'))
  try {
    // A directory named exactly TODO.md must not be mistaken for the backlog file.
    await mkdir(join(cwd, 'TODO.md'))
    assert.equal(await findFlatTodo(cwd), undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
