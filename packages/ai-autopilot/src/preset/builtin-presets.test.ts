import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDomainPresets } from './load.js'
import { selectPreset } from './compose.js'

// The built-in presets added alongside software-development. They are pure
// .md content, auto-discovered by builtinDomainPresets(); these guard their shape.
const CASES = [
  {
    name: 'web-development',
    title: 'Web Development',
    skillUrl: 'https://web.dev/',
    majorRun: ['accessibility-review', 'performance-budget', 'web-security'],
    technicalRun: ['accessibility-review'],
  },
  {
    name: 'data-science',
    title: 'Data Science',
    skillUrl: 'https://developers.google.com/machine-learning/guides/rules-of-ml',
    majorRun: ['reproducibility-review', 'data-validation', 'methodology-review'],
    technicalRun: ['reproducibility-review'],
  },
  {
    name: 'product-management',
    title: 'Product Management',
    skillUrl: 'https://basecamp.com/shapeup',
    majorRun: ['requirements-review', 'user-experience-review', 'metrics-review'],
    technicalRun: ['requirements-review'],
  },
  {
    name: 'biological-science',
    title: 'Biological Science',
    skillUrl: 'https://doi.org/10.1371/journal.pcbi.1003285',
    majorRun: ['experimental-design-review', 'data-provenance-review', 'statistical-rigor-review'],
    technicalRun: ['experimental-design-review'],
  },
]

const majorLoop = (p: { loops: readonly { on: readonly string[]; run: readonly string[] }[] }) =>
  p.loops.find(l => l.on.includes('major-change'))!

for (const c of CASES) {
  describe(`${c.name} (shipped built-in)`, () => {
    it('loads the {loops, prompts, skills} bundle from the shipped directory', async () => {
      const preset = selectPreset(await builtinDomainPresets(), c.name)
      assert.ok(preset, `${c.name} is discovered`)
      assert.equal(preset!.title, c.title)
      assert.ok(preset!.description.length > 0)
      assert.equal(preset!.loops.length, 2) // major-change + bug-fix
      assert.ok(preset!.prompts.length >= 5)
      assert.equal(preset!.skills.length, 1)
      assert.equal(preset!.skills[0]!.url, c.skillUrl)
    })

    it('targets non-web loop events (major-change, bug-fix)', async () => {
      const preset = selectPreset(await builtinDomainPresets(), c.name)!
      const kinds = preset.loops.flatMap(l => [...l.on]).sort()
      assert.deepEqual(kinds, ['bug-fix', 'major-change'])
    })

    it('every id a loop dispatches resolves to a shipped, non-empty prompt body', async () => {
      const preset = selectPreset(await builtinDomainPresets(), c.name)!
      const byId = new Map(preset.prompts.map(p => [p.id, p]))
      for (const loop of preset.loops) {
        for (const id of loop.run) {
          const prompt = byId.get(id)
          assert.ok(prompt, `loop prompt "${id}" has a shipped body`)
          assert.ok(prompt!.instructions.length > 0, `"${id}" body is non-empty`)
        }
      }
    })

    it('major-change review prompts carry the { blockers } verdict footer so the loop gates', async () => {
      const preset = selectPreset(await builtinDomainPresets(), c.name)!
      const byId = new Map(preset.prompts.map(p => [p.id, p]))
      for (const id of majorLoop(preset).run) {
        assert.match(
          byId.get(id)!.instructions,
          /"blockers"/,
          `"${id}" ends with a blockers verdict footer`,
        )
      }
    })

    it('Technical Control mode overrides the major-change loop with the leaner variant', async () => {
      const base = selectPreset(await builtinDomainPresets(), c.name)!
      const technical = selectPreset(await builtinDomainPresets({ modes: ['technical'] }), c.name)!
      assert.deepEqual([...majorLoop(base).run], c.majorRun)
      assert.deepEqual([...majorLoop(technical).run], c.technicalRun) // the variant wins
      assert.equal(technical.loops.length, 2) // replaces the base, not adds
    })
  })
}
