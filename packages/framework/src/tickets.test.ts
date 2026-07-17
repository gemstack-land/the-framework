import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FLAT_TODO_FILE, LEGACY_TODO_FILE, TICKETS_DIR, findFlatTodo } from './tickets.js'

test('the flat backlog lives at tickets/TODO.md, with the legacy root file named', () => {
  assert.equal(TICKETS_DIR, 'tickets')
  assert.equal(FLAT_TODO_FILE, 'tickets/TODO.md')
  assert.equal(LEGACY_TODO_FILE, 'TODO.md')
})

test('findFlatTodo prefers tickets/TODO.md, falls back to legacy root TODO.md, else undefined (#629)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-tickets-'))
  try {
    assert.equal(await findFlatTodo(cwd), undefined)

    // Only a legacy root TODO.md -> that is returned (existing repos keep their backlog).
    await writeFile(join(cwd, 'TODO.md'), '- [ ] legacy\n')
    assert.equal(await findFlatTodo(cwd), 'TODO.md')

    // tickets/TODO.md present -> it wins over the legacy root file.
    await mkdir(join(cwd, TICKETS_DIR))
    await writeFile(join(cwd, FLAT_TODO_FILE), '- [ ] new\n')
    assert.equal(await findFlatTodo(cwd), 'tickets/TODO.md')
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
