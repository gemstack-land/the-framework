import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillRegistry } from './registry.js'

let root: string

async function writeSkill(dir: string, name: string, withTools = false): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} desc\n---\n${name} body`)
  if (withTools) {
    await writeFile(
      join(dir, 'tools.mjs'),
      `export const t = { definition: { name: '${name}_tool', description: 'x', inputSchema: {} }, execute: async () => 'ok' }`,
    )
  }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-skills-reg-'))
  await writeSkill(join(root, 'alpha'), 'alpha', true)
  await writeSkill(join(root, 'beta'), 'beta')
  // a non-skill directory (no SKILL.md) that discovery must ignore
  await mkdir(join(root, 'not-a-skill'), { recursive: true })
  await writeFile(join(root, 'not-a-skill', 'readme.txt'), 'nope')
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('SkillRegistry', () => {
  it('discovers SKILL.md subdirs by frontmatter and ignores non-skill dirs', async () => {
    const registry = new SkillRegistry()
    const found = await registry.discover(root)
    const names = found.map(e => e.manifest.name).sort()
    assert.deepEqual(names, ['alpha', 'beta'])
    assert.deepEqual(registry.list().map(e => e.manifest.name).sort(), ['alpha', 'beta'])
    assert.equal(registry.get('alpha')?.dir, join(root, 'alpha'))
  })

  it('discover() reads only frontmatter — entries carry a manifest but are not loaded', async () => {
    const registry = new SkillRegistry()
    const [entry] = await registry.discover(root)
    assert.ok(entry?.manifest.name)
    assert.ok(!('tools' in entry!))   // index entry has no tools until load()
  })

  it('load() fully loads a discovered skill and caches it', async () => {
    const registry = new SkillRegistry()
    await registry.discover(root)
    const a1 = await registry.load('alpha')
    assert.deepEqual(a1.tools.map(t => t.definition.name), ['alpha_tool'])
    const a2 = await registry.load('alpha')
    assert.equal(a1, a2)   // same cached instance
  })

  it('load() throws for an undiscovered name', async () => {
    const registry = new SkillRegistry()
    await registry.discover(root)
    await assert.rejects(() => registry.load('ghost'), /no skill named "ghost"/)
  })

  it('returns an empty index for a missing root', async () => {
    const registry = new SkillRegistry()
    const found = await registry.discover(join(root, 'nope'))
    assert.deepEqual(found, [])
  })

  it('loadAll loads discovered skills by name in order', async () => {
    const registry = new SkillRegistry()
    await registry.discover(root)
    const skills = await registry.loadAll(['beta', 'alpha'])
    assert.deepEqual(skills.map(s => s.manifest.name), ['beta', 'alpha'])
  })
})
