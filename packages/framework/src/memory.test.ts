import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRepoMemory, memoryFraming, MEMORY_FILES } from './memory.js'

test('loadRepoMemory reads present files and leaves missing ones without content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'repo-memory-'))
  try {
    await writeFile(join(dir, 'CODE-OVERVIEW.md'), '  A tiny app.\n')
    await writeFile(join(dir, 'KNOWLEDGE-BASE.md'), '') // empty file -> no content
    const loaded = await loadRepoMemory(dir)
    // every canonical file comes back, so the agent is told to create missing ones
    assert.equal(loaded.length, MEMORY_FILES.length)
    const overview = loaded.find(m => m.name === 'CODE-OVERVIEW.md')
    assert.equal(overview?.content, 'A tiny app.') // trimmed
    assert.equal(loaded.find(m => m.name === 'KNOWLEDGE-BASE.md')?.content, undefined)
    assert.equal(loaded.find(m => m.name === 'BRAINSTORMING.md')?.content, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('memoryFraming is empty for an empty list', () => {
  assert.equal(memoryFraming([]), '')
})

test('memoryFraming separates agent-owned files from framework-owned, and shows current contents', () => {
  const framing = memoryFraming([
    { name: 'CODE-OVERVIEW.md', purpose: 'a map of the codebase', content: 'It is a blog.' },
    { name: 'KNOWLEDGE-BASE.md', purpose: 'durable facts' }, // absent
    { name: 'DECISIONS.md', purpose: 'the decision log', agentMaintained: false },
  ])
  // agent-owned files land under the "keep up to date" instruction
  assert.match(framing, /Keep these up to date[\s\S]*CODE-OVERVIEW\.md/)
  // DECISIONS.md is flagged read-only so the agent will not clobber our ledger write
  assert.match(framing, /Read-only[\s\S]*DECISIONS\.md/)
  assert.doesNotMatch(framing.split('Read-only')[0]!, /DECISIONS\.md/) // not in the owned list
  // present contents are inlined
  assert.match(framing, /### CODE-OVERVIEW\.md\nIt is a blog\./)
})

test('memoryFraming tells the agent to start the files when none exist yet', () => {
  const framing = memoryFraming([{ name: 'CODE-OVERVIEW.md', purpose: 'a map of the codebase' }])
  assert.match(framing, /None exist yet/)
})
