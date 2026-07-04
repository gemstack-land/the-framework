import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { personaInstructions } from './compose.js'
import {
  uiIntentDesigner,
  vikeAuthComposer,
  vikeCrudComposer,
  vikeDataModeler,
  vikeExtensionPersonas,
} from './library.js'

describe('vike extension personas', () => {
  it('vikeAuthComposer teaches composing vike-auth instead of hand-rolling auth', () => {
    assert.equal(vikeAuthComposer.name, 'vike-auth-composer')
    const text = personaInstructions(vikeAuthComposer)
    // Real install + wiring, so the agent composes rather than reinventing.
    assert.match(text, /npm install vike-auth/)
    assert.match(text, /vike-auth\/react/)
    assert.match(text, /setAdapter\(createMemoryAdapter\(\)\)/)
    assert.match(text, /useUser\(\)/)
    // And it must forbid re-modeling users/sessions in the app's own ORM.
    assert.match(text, /Do NOT write auth UI/)
    assert.match(text, /do NOT model users or\s*\n?\s*sessions/i)
  })

  it('vikeDataModeler teaches the universal-orm data layer, not a hand-installed ORM', () => {
    assert.equal(vikeDataModeler.name, 'vike-data-modeler')
    const text = personaInstructions(vikeDataModeler)
    assert.match(text, /@universal-orm\/core/)
    assert.match(text, /defineSchema/)
    assert.match(text, /createRepository/)
    assert.match(text, /getAdapter\(\)/)
    // The dev default: do NOT reach for Prisma/Drizzle/SQLite/migrations.
    assert.match(text, /Do NOT add Prisma, Drizzle,\s*\n?\s*SQLite/i)
    // But it must also teach the opt-in real-persistence path (drizzle + pglite),
    // so a composed app can survive a restart without changing schema/queries.
    assert.match(text, /Make it real/)
    assert.match(text, /registerDrizzle/)
    assert.match(text, /pglite/)
    assert.match(text, /vikeSchema\(\)/)
    assert.match(text, /drizzle-kit generate/)
  })

  it('vikeCrudComposer teaches deriving CRUD/admin UI from the schema, not hand-written screens', () => {
    assert.equal(vikeCrudComposer.name, 'vike-crud-composer')
    const text = personaInstructions(vikeCrudComposer)
    // Derive the screens with vike-crud / vike-admin rather than hand-authoring them.
    assert.match(text, /crud\(\{ table \}\)/)
    assert.match(text, /crudBlocks\(\{ table \}\)/)
    assert.match(text, /definePage\(\{ route, sections \}\)/)
    assert.match(text, /vike-admin/)
    assert.match(text, /instead of hand-writing list\/record\/form/)
    // Mutations go through named actions, never inline closures.
    assert.match(text, /crudActions\(\{ table, tables, scope \}\)/)
    assert.match(text, /BY NAME/)
    // The customization ladder ends at eject, reached last.
    assert.match(text, /ejectView\(view, \{ framework \}\)/)
  })

  it('vikeExtensionPersonas composes data + auth + crud (no Prisma, no hand-rolled auth/UI)', () => {
    const names = vikeExtensionPersonas.map(p => p.name)
    assert.deepEqual(names, ['vike-data-modeler', 'vike-auth-composer', 'vike-crud-composer', 'ui-intent-designer'])
    assert.ok(vikeExtensionPersonas.includes(uiIntentDesigner))
  })
})
