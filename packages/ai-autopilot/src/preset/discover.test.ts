import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinDomainPresets, loadDomainPresetsFrom } from './load.js'
import { selectPreset } from './compose.js'

async function writePreset(root: string, name: string, title: string) {
  const dir = join(root, name)
  await mkdir(dir)
  await writeFile(
    join(dir, 'preset.md'),
    `---\nname: ${name}\ndescription: The ${title} domain.\nmetadata:\n  title: ${title}\n---\nA domain preset.\n`,
  )
  return dir
}

describe('loadDomainPresetsFrom', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'domain-presets-'))
    await writePreset(dir, 'web-dev', 'Web Development')
    await writePreset(dir, 'data-science', 'Data Science')
    // a subdirectory without a preset.md is skipped
    await mkdir(join(dir, 'not-a-preset'))
    await writeFile(join(dir, 'not-a-preset', 'readme.md'), '# nope\n')
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads every subdirectory that has a preset.md, sorted by name', async () => {
    const presets = await loadDomainPresetsFrom(dir)
    assert.deepEqual(
      presets.map(p => p.name),
      ['data-science', 'web-dev'],
    )
  })

  it('skips subdirectories without a preset.md', async () => {
    const presets = await loadDomainPresetsFrom(dir)
    assert.equal(
      presets.find(p => p.name === 'not-a-preset'),
      undefined,
    )
  })

  it('is pickable by name with selectPreset', async () => {
    const presets = await loadDomainPresetsFrom(dir)
    const picked = selectPreset(presets, 'web-dev')
    assert.equal(picked?.title, 'Web Development')
    assert.equal(selectPreset(presets, 'no-such-domain'), undefined)
  })

  it('returns [] for a directory that does not exist', async () => {
    assert.deepEqual(await loadDomainPresetsFrom(join(tmpdir(), 'no-such-presets-dir-xyz')), [])
  })
})

describe('builtinDomainPresets', () => {
  it('enumerates the shipped presets, including software-development', async () => {
    const presets = await builtinDomainPresets()
    assert.ok(presets.length >= 1)
    const sd = selectPreset(presets, 'software-development')
    assert.ok(sd, 'software-development is a shipped built-in')
    assert.ok(sd!.loops.length >= 1)
    assert.ok(sd!.prompts.length >= 1)
    // every loop's prompt ids resolve to a shipped prompt body
    const ids = new Set(sd!.prompts.map(p => p.id))
    for (const loop of sd!.loops) {
      for (const id of loop.run) assert.ok(ids.has(id), `loop prompt ${id} has a body`)
    }
  })
})
