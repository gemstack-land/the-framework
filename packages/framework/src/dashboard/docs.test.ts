import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDocs, DOC_CATEGORIES } from './docs.js'

test('readDocs returns the surfaced docs present at the workspace root, PLAN before TODO (#319)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-docs-'))
  try {
    // Write TODO first to prove the result follows category order, not write order.
    await writeFile(join(cwd, 'TODO.md'), '- [ ] later\n')
    await writeFile(join(cwd, 'PLAN.md'), '# Plan\n')
    const docs = await readDocs(cwd)
    assert.deepEqual(docs.map(d => d.name), ['PLAN.md', 'TODO.md'])
    assert.equal(docs[0]!.content, '# Plan\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('readDocs surfaces session-scoped PLAN_/TODO_ .agent.md files (#323/#326)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-docs-'))
  try {
    await writeFile(join(cwd, 'TODO_my-branch.agent.md'), '- [ ] later\n')
    await writeFile(join(cwd, 'PLAN_my-branch.agent.md'), '# Plan\n')
    // A flat file coexists as a fallback and sorts before the scoped one in its group.
    await writeFile(join(cwd, 'PLAN.md'), '# Flat plan\n')
    // An unrelated .md is not surfaced.
    await writeFile(join(cwd, 'README.md'), '# Readme\n')
    const docs = await readDocs(cwd)
    assert.deepEqual(docs.map(d => d.name), ['PLAN.md', 'PLAN_my-branch.agent.md', 'TODO_my-branch.agent.md'])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('readDocs surfaces the flat backlog from tickets/TODO.md, after PLAN (#629)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-docs-'))
  try {
    await mkdir(join(cwd, 'tickets'))
    await writeFile(join(cwd, 'tickets/TODO.md'), '- [ ] roadmap\n')
    await writeFile(join(cwd, 'PLAN.md'), '# Plan\n')
    const docs = await readDocs(cwd)
    assert.deepEqual(docs.map(d => d.name), ['PLAN.md', 'tickets/TODO.md'])
    assert.equal(docs[1]!.content, '- [ ] roadmap\n')
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

test('DOC_CATEGORIES match fixed roots + slug-only scoped names (no traversal)', () => {
  for (const cat of DOC_CATEGORIES) {
    assert.doesNotMatch(cat.flat, /[\\/]|\.\./)
    // The optional `dir` (e.g. tickets/) is a fixed slug, not user input, so no traversal.
    if ('dir' in cat) assert.match(cat.dir, /^[a-z0-9-]+$/)
    // The scoped pattern only admits a-z0-9- slugs, so no path separators slip in.
    assert.ok(!cat.scoped.test('PLAN_../evil.agent.md'))
    assert.ok(!cat.scoped.test('PLAN_a/b.agent.md'))
  }
  assert.ok(DOC_CATEGORIES[0]!.scoped.test('PLAN_my-branch.agent.md'))
  assert.ok(DOC_CATEGORIES[1]!.scoped.test('TODO_main-2.agent.md'))
})
