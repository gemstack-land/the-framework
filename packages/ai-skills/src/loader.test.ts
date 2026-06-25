import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSkill, loadSkills } from './loader.js'
import { SkillManifestError } from './manifest.js'

let root: string

const SKILL_MD = `---
name: refunds
description: Issue refunds
trigger: a refund request
---

# Refunds

Look up the order, then issue the refund.`

// Plain-JS tools module (no imports) shaped like ai-sdk Tools.
const TOOLS_MJS = `export const issueRefund = {
  definition: { name: 'issue_refund', description: 'Issue a refund', inputSchema: {} },
  execute: async () => ({ refunded: true }),
}
export default [issueRefund]
`

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-skills-'))

  // Full skill: SKILL.md + tools.mjs + a resource file
  const full = join(root, 'refunds')
  await mkdir(join(full, 'resources'), { recursive: true })
  await writeFile(join(full, 'SKILL.md'), SKILL_MD)
  await writeFile(join(full, 'tools.mjs'), TOOLS_MJS)
  await writeFile(join(full, 'resources', 'policy.md'), '# Refund policy')

  // Body-only skill: SKILL.md, no tools, no resources
  const bare = join(root, 'greeting')
  await mkdir(bare, { recursive: true })
  await writeFile(join(bare, 'SKILL.md'), `---\nname: greeting\ndescription: Greet\n---\nSay hello.`)
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('loadSkill', () => {
  it('loads manifest, instructions, tools, and resources from a directory', async () => {
    const skill = await loadSkill(join(root, 'refunds'))
    assert.equal(skill.manifest.name, 'refunds')
    assert.equal(skill.manifest.trigger, 'a refund request')
    assert.ok(skill.instructions.startsWith('# Refunds'))
    assert.deepEqual(skill.tools.map(t => t.definition.name), ['issue_refund'])
    assert.deepEqual(skill.resources.map(r => r.name), ['policy.md'])
    assert.equal(skill.dir, join(root, 'refunds'))
  })

  it('does not double-count a tool exported both named and via default array', async () => {
    const skill = await loadSkill(join(root, 'refunds'))
    assert.equal(skill.tools.length, 1)
  })

  it('loadTools:false skips the tools module (surface-before-compose)', async () => {
    const skill = await loadSkill(join(root, 'refunds'), { loadTools: false })
    assert.equal(skill.tools.length, 0)
    assert.ok(skill.instructions.length > 0)        // still gets instructions
    assert.deepEqual(skill.resources.map(r => r.name), ['policy.md'])
  })

  it('handles a skill with no tools or resources', async () => {
    const skill = await loadSkill(join(root, 'greeting'))
    assert.deepEqual(skill.tools, [])
    assert.deepEqual(skill.resources, [])
    assert.equal(skill.instructions, 'Say hello.')
  })

  it('throws a clear error when SKILL.md is missing', async () => {
    await assert.rejects(
      () => loadSkill(join(root, 'does-not-exist')),
      (e: unknown) => e instanceof SkillManifestError && /no SKILL\.md/.test((e as Error).message),
    )
  })
})

describe('loadSkills', () => {
  it('loads several skills preserving order', async () => {
    const skills = await loadSkills([join(root, 'greeting'), join(root, 'refunds')])
    assert.deepEqual(skills.map(s => s.manifest.name), ['greeting', 'refunds'])
  })
})
