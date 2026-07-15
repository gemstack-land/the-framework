import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { softwareDevelopmentPreset } from './load.js'

describe('softwareDevelopmentPreset (shipped built-in)', () => {
  it('loads the {loops, prompts} bundle from the shipped directory', async () => {
    const preset = await softwareDevelopmentPreset()
    assert.equal(preset.name, 'software-development')
    assert.equal(preset.title, 'Software Development')
    assert.ok(preset.description.length > 0)

    assert.equal(preset.loops.length, 2)
    assert.ok(preset.prompts.length >= 5)
  })

  it('every id a loop dispatches resolves to a shipped prompt body', async () => {
    const preset = await softwareDevelopmentPreset()
    const ids = new Set(preset.prompts.map(p => p.id))
    for (const loop of preset.loops) {
      for (const id of loop.run) {
        assert.ok(ids.has(id), `loop prompt "${id}" has a shipped body`)
        assert.ok(preset.prompts.find(p => p.id === id)!.instructions.length > 0, `"${id}" body is non-empty`)
      }
    }
  })

  it('targets non-web events (major-change, bug-fix)', async () => {
    const preset = await softwareDevelopmentPreset()
    const kinds = preset.loops.flatMap(l => [...l.on]).sort()
    assert.deepEqual(kinds, ['bug-fix', 'major-change'])
  })

  it('Technical Control mode overrides the major-change loop with the leaner variant', async () => {
    const base = await softwareDevelopmentPreset()
    const technical = await softwareDevelopmentPreset({ modes: ['technical'] })

    const majorOf = (p: Awaited<ReturnType<typeof softwareDevelopmentPreset>>) =>
      p.loops.find(l => l.on.includes('major-change'))!

    assert.deepEqual([...majorOf(base).run], ['code-review', 'test-coverage', 'security-review'])
    assert.deepEqual([...majorOf(technical).run], ['code-review']) // the variant wins
    // still exactly two loops (the variant replaces the base, not adds to it)
    assert.equal(technical.loops.length, 2)
  })
})
