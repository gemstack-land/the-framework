// relations v2 follow-ups (#130): composite (multi-column) foreign keys.
//
// A single-column FK is column-level (`t.uuid('user_id').references('users.id')`);
// a FK over >=2 columns references a multi-column key as a unit, so it is declared
// table-level (`t.foreignKey([...], target, [...])`) and each ORM spells it
// differently (Prisma fields:[a,b] / Drizzle foreignKey({columns,foreignColumns}) /
// Rudder t.foreign([...]).references([...]).on(...)).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema } from '../src/define.js'
import { mergeSchemas, deriveRelations, orderFragments } from '../src/merge.js'
import { toPrisma, toDrizzle, toRudder } from '../src/compilers.js'
import { generateArtifacts } from '../src/generate.js'

// a composite-keyed parent + a child that references it as a unit
const orgUnits = () =>
  defineSchema('org_units', (t) => {
    t.uuid('org_id')
    t.uuid('unit_id')
    t.string('name')
    t.primaryKey('org_id', 'unit_id')
  })
const assignments = (opts = {}) =>
  defineSchema('assignments', (t) => {
    t.uuid('id').primary()
    t.uuid('org_id')
    t.uuid('unit_id')
    t.foreignKey(['org_id', 'unit_id'], 'org_units', ['org_id', 'unit_id'], {
      onDelete: 'cascade',
      as: 'unit',
      inverseAs: 'assignments',
      ...opts,
    })
  })
const composite = () => mergeSchemas([orgUnits(), assignments()])

// ----------------------------------------------------- DSL --------------------

test('t.foreignKey records a table-level composite FK on the fragment', () => {
  const frag = assignments()
  assert.deepEqual(frag.foreignKeys, [
    {
      columns: ['org_id', 'unit_id'],
      references: { table: 'org_units', columns: ['org_id', 'unit_id'] },
      onDelete: 'cascade',
      relationField: 'unit',
      inverseField: 'assignments',
    },
  ])
  // the local columns themselves carry no per-column `references`
  assert.ok(frag.columns.every((c) => !c.references))
})

test('a table with no composite FK carries no foreignKeys field (back-compat)', () => {
  const frag = defineSchema('users', (t) => t.uuid('id').primary())
  assert.equal('foreignKeys' in frag, false)
})

test('t.foreignKey rejects a local column that was not declared', () => {
  assert.throws(
    () => defineSchema('t', (t) => {
      t.uuid('org_id')
      t.foreignKey(['org_id', 'nope'], 'org_units', ['org_id', 'unit_id'])
    }),
    /unknown column "nope"/,
  )
})

test('t.foreignKey rejects a local/target column count mismatch', () => {
  assert.throws(
    () => defineSchema('t', (t) => {
      t.uuid('org_id')
      t.foreignKey(['org_id'], 'org_units', ['org_id', 'unit_id'])
    }),
    /column count mismatch/,
  )
})

// ----------------------------------------------- merge + validation -----------

test('merge carries the composite FK onto the table, no conflicts when the target exists', () => {
  const { tables, conflicts } = composite()
  assert.deepEqual(conflicts, [])
  const child = tables.find((t) => t.table === 'assignments')
  assert.equal(child.foreignKeys.length, 1)
  assert.deepEqual(child.foreignKeys[0].references.columns, ['org_id', 'unit_id'])
})

test('a composite FK to an unknown table is flagged', () => {
  const { conflicts } = mergeSchemas([assignments()]) // no org_units
  assert.ok(conflicts.some((c) => c.kind === 'unknown-reference-table' && c.target === 'org_units' && c.column === 'org_id, unit_id'))
})

test('a composite FK to an unknown target column is flagged per column', () => {
  const child = defineSchema('assignments', (t) => {
    t.uuid('org_id')
    t.uuid('unit_id')
    t.foreignKey(['org_id', 'unit_id'], 'org_units', ['org_id', 'missing'])
  })
  const { conflicts } = mergeSchemas([orgUnits(), child])
  assert.ok(conflicts.some((c) => c.kind === 'unknown-reference-column' && c.target === 'org_units.missing'))
})

test('orderFragments puts a composite-FK target before its dependant', () => {
  const ordered = orderFragments([assignments(), orgUnits()]) // wrong order in
  const tables = ordered.map((f) => f.table)
  assert.ok(tables.indexOf('org_units') < tables.indexOf('assignments'))
})

// ----------------------------------------------------- relations --------------

test('deriveRelations emits one composite relation with column arrays + collision-free name', () => {
  const { tables } = composite()
  const rels = deriveRelations(tables)
  const fwd = rels.get('assignments').forward
  assert.equal(fwd.length, 1)
  assert.equal(fwd[0].name, 'assignments_org_id_unit_id')
  assert.deepEqual(fwd[0].fkColumns, ['org_id', 'unit_id'])
  assert.deepEqual(fwd[0].refColumns, ['org_id', 'unit_id'])
  assert.equal(fwd[0].toOne, false)
  assert.equal(fwd[0].fieldName, 'unit') // `as`
  // the parent sees it on its inverse side
  assert.equal(rels.get('org_units').inverse.length, 1)
  assert.equal(rels.get('org_units').inverse[0].inverseFieldName, 'assignments') // `inverseAs`
})

// ----------------------------------------------------- compilers --------------

test('Prisma renders a composite FK as fields:[..] / references:[..] arrays + inverse', () => {
  const { tables } = composite()
  const rels = deriveRelations(tables)
  const childOut = toPrisma(tables.find((t) => t.table === 'assignments'), rels.get('assignments'))
  assert.match(childOut, /unit OrgUnits @relation\("assignments_org_id_unit_id", fields: \[org_id, unit_id\], references: \[org_id, unit_id\], onDelete: Cascade\)/)
  const parentOut = toPrisma(tables.find((t) => t.table === 'org_units'), rels.get('org_units'))
  assert.match(parentOut, /assignments Assignments\[\] @relation\("assignments_org_id_unit_id"\)/)
})

test('Drizzle renders a composite FK in the table-extra block + imports foreignKey', () => {
  const { tables } = composite()
  const out = toDrizzle(tables.find((t) => t.table === 'assignments'))
  assert.match(out, /fk: foreignKey\(\{ columns: \[table\.orgId, table\.unitId\], foreignColumns: \[orgUnits\.orgId, orgUnits\.unitId\] \}\)\.onDelete\('cascade'\)/)
  assert.match(out, /import \{ pgTable, .*foreignKey.* \} from 'drizzle-orm\/pg-core'/)
})

test('Rudder renders a composite FK as a table-level t.foreign([...]).references([...]).on(...)', () => {
  const { tables } = composite()
  const out = toRudder(tables.find((t) => t.table === 'assignments'))
  assert.match(out, /t\.foreign\(\['org_id', 'unit_id'\]\)\.references\(\['org_id', 'unit_id'\]\)\.on\('org_units'\)\.onDelete\('cascade'\)/)
})

test('a table with no composite FK is unchanged: no foreignKey import / t.foreign(', () => {
  const { tables } = mergeSchemas([defineSchema('users', (t) => t.uuid('id').primary())])
  const users = tables[0]
  assert.ok(!/\bforeignKey\b/.test(toDrizzle(users)))
  assert.ok(!toRudder(users).includes('t.foreign('))
})

// ----------------------------------------------------- generate ---------------

test('the generated Drizzle file hoists the foreignKey import when a composite FK exists', () => {
  const { tables } = composite()
  const [{ contents }] = generateArtifacts({ tables }, 'drizzle')
  assert.match(contents, /import \{ pgTable, .*foreignKey.* \} from 'drizzle-orm\/pg-core'/)
  assert.equal((contents.match(/^import .*\bforeignKey\b/gm) || []).length, 1)
})
