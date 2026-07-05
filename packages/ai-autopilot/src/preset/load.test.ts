import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDomainPreset, loadLoopsFrom, loadSkillsFrom } from './load.js'
import { DomainPresetError } from './define.js'

async function writeFixture(root: string) {
  await writeFile(
    join(root, 'preset.md'),
    `---\nname: software-development\ndescription: General software engineering.\nmetadata:\n  title: Software Development\n---\nA domain preset for building software.\n`,
  )
  await mkdir(join(root, 'loops'))
  await writeFile(
    join(root, 'loops', 'major-change.md'),
    `---\nname: major-change\ndescription: What fires on a major change.\nmetadata:\n  on: major-change\n  run: [review, security]\n---\nIf the change is substantial, review it then check security.\n`,
  )
  await mkdir(join(root, 'prompts'))
  await writeFile(
    join(root, 'prompts', 'review.md'),
    `---\nname: review\ndescription: Review a change.\nmetadata:\n  loopId: review\n---\nReview the change for correctness.\n`,
  )
  await writeFile(
    join(root, 'prompts', 'review.technical.md'),
    `---\nname: review-technical\ndescription: Review a change (technical mode).\nmetadata:\n  loopId: review\n  conditions: technical\n---\nDeep technical review: trace every path.\n`,
  )
  await mkdir(join(root, 'skills'))
  await writeFile(
    join(root, 'skills', 'vike.md'),
    `---\nname: vike\ndescription: Vike page/routing knowledge.\nmetadata:\n  title: Vike\n  url: https://vike.dev/llms.txt\n---\n`,
  )
}

describe('loadDomainPreset', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'domain-preset-'))
    await writeFixture(dir)
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads {loops, prompts, skills} from a directory of .md files', async () => {
    const preset = await loadDomainPreset(dir)
    assert.equal(preset.name, 'software-development')
    assert.equal(preset.title, 'Software Development')
    assert.equal(preset.description, 'General software engineering.')

    assert.equal(preset.loops.length, 1)
    assert.deepEqual([...preset.loops[0]!.on], ['major-change'])
    assert.deepEqual([...preset.loops[0]!.run], ['review', 'security'])

    assert.equal(preset.prompts.length, 1)
    assert.equal(preset.prompts[0]!.id, 'review')
    assert.match(preset.prompts[0]!.instructions, /correctness/)

    assert.equal(preset.skills.length, 1)
    assert.equal(preset.skills[0]!.name, 'vike')
    assert.equal(preset.skills[0]!.url, 'https://vike.dev/llms.txt')
    assert.equal(preset.skills[0]!.title, 'Vike')
  })

  it('loads only base files when no mode is active', async () => {
    const preset = await loadDomainPreset(dir)
    assert.equal(preset.prompts.length, 1) // the technical variant is not active
    assert.match(preset.prompts[0]!.instructions, /correctness/)
  })

  it('a conditions variant overrides its base under an active mode', async () => {
    const preset = await loadDomainPreset(dir, { modes: ['technical'] })
    assert.equal(preset.prompts.length, 1) // still one prompt for id "review" — the variant replaced the base
    assert.equal(preset.prompts[0]!.id, 'review')
    assert.match(preset.prompts[0]!.instructions, /trace every path/)
  })

  it('throws when preset.md is missing', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'domain-preset-empty-'))
    try {
      await assert.rejects(loadDomainPreset(empty), DomainPresetError)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe('loadLoopsFrom / loadSkillsFrom', () => {
  it('return [] for a directory that does not exist', async () => {
    assert.deepEqual(await loadLoopsFrom(join(tmpdir(), 'no-such-loops-dir-xyz')), [])
    assert.deepEqual(await loadSkillsFrom(join(tmpdir(), 'no-such-skills-dir-xyz')), [])
  })
})

describe('loadDomainPreset defaultEvent', () => {
  it('reads metadata.event from preset.md, absent when unset', async () => {
    const withEvent = await mkdtemp(join(tmpdir(), 'domain-preset-event-'))
    const without = await mkdtemp(join(tmpdir(), 'domain-preset-noevent-'))
    try {
      await writeFile(
        join(withEvent, 'preset.md'),
        `---\nname: bug-triage\ndescription: Fix bugs.\nmetadata:\n  event: bug-fix\n---\nA triage preset.\n`,
      )
      await writeFile(join(without, 'preset.md'), `---\nname: sw-dev\ndescription: Build software.\n---\nA preset.\n`)
      assert.equal((await loadDomainPreset(withEvent)).defaultEvent, 'bug-fix')
      assert.equal('defaultEvent' in (await loadDomainPreset(without)), false)
    } finally {
      await rm(withEvent, { recursive: true, force: true })
      await rm(without, { recursive: true, force: true })
    }
  })
})
