import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FLAT_TODO_FILE,
  LEGACY_HYPHEN_TODO_FILE,
  LEGACY_TICKETS_TODO_FILE,
  LEGACY_TODO_FILE,
  TICKETS_DIR,
  TICKETING_FORMAT_FILE,
  TODO_FORMAT_FILE,
  findFlatTodo,
} from './tickets.js'
import { TICKETING_FORMAT, TODO_FORMAT } from './prompts.generated.js'

test('the flat backlog lives at the root TODO_AGENTS.md, with the legacy locations named (#674/#682)', () => {
  assert.equal(TICKETS_DIR, 'tickets')
  assert.equal(FLAT_TODO_FILE, 'TODO_AGENTS.md')
  assert.equal(LEGACY_HYPHEN_TODO_FILE, 'TODO-AGENTS.md')
  assert.equal(LEGACY_TICKETS_TODO_FILE, 'tickets/TODO.md')
  assert.equal(LEGACY_TODO_FILE, 'TODO.md')
})

test('the ticket-format spec ships in the package (not materialized), with priority/topics (#684/#674)', () => {
  // Per Rom's #674 call it is not written into the repo; it ships inside the package and the
  // context fragment reads it by its node_modules path, so the format versions with the package.
  assert.equal(TICKETING_FORMAT_FILE, 'node_modules/@gemstack/the-framework/prompts/ticketing_format.md')
  // The spec teaches both file shapes and the revised #684 optional priority/topics fields.
  assert.ok(TICKETING_FORMAT.includes('tickets/<DATE>_<SLUG>.md'))
  assert.ok(TICKETING_FORMAT.includes('tickets/<DATE>_<SLUG>.spike.md'))
  assert.ok(TICKETING_FORMAT.includes('priority: low/medium/high/urgent'))
  assert.ok(TICKETING_FORMAT.includes('topics:'))
})

test('the backlog-format spec ships in the package and teaches the priority sections (#880)', () => {
  // Ships inside the package like the ticket format, so the layout versions with the package.
  assert.equal(TODO_FORMAT_FILE, 'node_modules/@gemstack/the-framework/prompts/todo_format.md')
  assert.ok(TODO_FORMAT.includes(FLAT_TODO_FILE))
  // A numeric 0-10 scale, not named tiers: 10 is act-immediately, 0 is only-if-capacity.
  for (const section of ['## Priority 10 (critical', '## Priority 9', '## Priority 0 (only if capacity)']) {
    assert.ok(TODO_FORMAT.includes(section), `expected the ${section} section`)
  }
  // Priority 10 is the exception, not the default, and the file is priority-sorted.
  assert.ok(TODO_FORMAT.includes('Priority 10 is rarely used'))
  assert.ok(TODO_FORMAT.includes('sorted by priority'))
})

test('findFlatTodo prefers TODO_AGENTS.md, then legacy tickets/TODO.md, then root TODO.md, else undefined (#682)', async () => {
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

    // The brief #682 hyphen spelling wins over the older locations.
    await writeFile(join(cwd, LEGACY_HYPHEN_TODO_FILE), '- [ ] hyphen\n')
    assert.equal(await findFlatTodo(cwd), 'TODO-AGENTS.md')

    // The #674 root TODO_AGENTS.md (underscore) wins over every legacy location.
    await writeFile(join(cwd, FLAT_TODO_FILE), '- [ ] current\n')
    assert.equal(await findFlatTodo(cwd), 'TODO_AGENTS.md')
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
