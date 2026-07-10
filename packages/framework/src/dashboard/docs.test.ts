import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDocs, SURFACED_DOCS } from './docs.js'

test('readDocs returns the surfaced docs present at the workspace root, in order (#319)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-docs-'))
  try {
    // Write TODO first to prove the result follows SURFACED_DOCS order, not write order.
    await writeFile(join(cwd, 'TODO.md'), '- [ ] later\n')
    await writeFile(join(cwd, 'PLAN.md'), '# Plan\n')
    const docs = await readDocs(cwd)
    assert.deepEqual(docs.map(d => d.name), ['PLAN.md', 'TODO.md'])
    assert.equal(docs[0]!.content, '# Plan\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('readDocs skips missing and blank docs, and never throws', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-docs-'))
  try {
    await writeFile(join(cwd, 'PLAN.md'), '   \n\n')
    // TODO.md absent; PLAN.md blank -> nothing surfaced.
    assert.deepEqual(await readDocs(cwd), [])
    // A workspace that does not exist reads as empty, not an error.
    assert.deepEqual(await readDocs(join(cwd, 'nope')), [])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('SURFACED_DOCS are fixed workspace-root filenames (no traversal)', () => {
  for (const name of SURFACED_DOCS) assert.doesNotMatch(name, /[\\/]|\.\./)
})
