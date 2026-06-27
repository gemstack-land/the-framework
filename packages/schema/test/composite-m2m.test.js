// relations v2 follow-ups (#17): composite primary keys + many-to-many sugar.
//
// Single-column PKs are column-level (`t.uuid('id').primary()`); a composite PK
// over >=2 columns is table-level (`t.primaryKey(a, b)`) and each ORM spells it
// differently (@@id / primaryKey() / t.primary([...])). Many-to-many has no
// column model of its own — `defineJoinTable` derives the join table (two FKs +
// a composite PK over them) that IS the relation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema, defineJoinTable } from '../src/define.js'
import { mergeSchemas, deriveRelations } from '../src/merge.js'
import { toPrisma, toDrizzle, toRudder } from '../src/compilers.js'
import { generateArtifacts } from '../src/generate.js'

// ----------------------------------------------------- composite PK: DSL ------

test('t.primaryKey records a table-level composite key on the fragment', () => {
  const frag = defineSchema('roles_users', (t) => {
    t.uuid('user_id')
    t.uuid('role_id')
    t.primaryKey('user_id', 'role_id')
  })
  assert.deepEqual(frag.primaryKey, ['user_id', 'role_id'])
  // the columns themselves stay non-primary (the PK is the table constraint)
  assert.ok(frag.columns.every((c) => !c.primary))
})

test('a single-PK table carries no primaryKey field (back-compat)', () => {
  const frag = defineSchema('users', (t) => t.uuid('id').primary())
  assert.equal('primaryKey' in frag, false)
})

test('t.primaryKey rejects a column that was not declared', () => {
  assert.throws(
    () => defineSchema('t', (t) => {
      t.uuid('a')
      t.primaryKey('a', 'missing')
    }),
    /unknown column "missing"/,
  )
})

// ---------------------------------------------- defineJoinTable: derivation ---

test('defineJoinTable derives name, FK columns, references and the composite PK', () => {
  const frag = defineJoinTable('users', 'roles')
  assert.equal(frag.table, 'roles_users') // deterministic: alphabetical
  assert.deepEqual(frag.primaryKey, ['user_id', 'role_id'])
  const byName = Object.fromEntries(frag.columns.map((c) => [c.name, c]))
  assert.deepEqual(byName.user_id.references, { table: 'users', column: 'id' })
  assert.deepEqual(byName.role_id.references, { table: 'roles', column: 'id' })
  assert.equal(byName.user_id.onDelete, 'cascade')
  assert.equal(byName.role_id.onDelete, 'cascade')
})

test('defineJoinTable singularizes pluralized table names for FK columns', () => {
  const frag = defineJoinTable('companies', 'addresses')
  const names = frag.columns.map((c) => c.name).sort()
  assert.deepEqual(names, ['address_id', 'company_id']) // companies->company, addresses->address
})

test('defineJoinTable throws when both FKs resolve to the same column', () => {
  // Regression: a self-referential m2m (friendships/followers) made both FK columns
  // `user_id`, silently emitting a duplicate column + a [user_id, user_id] PK. Now it
  // throws — and points at defineSchema, since `columns` (keyed by table name) can't help a
  // self-join.
  assert.throws(
    () => defineJoinTable('users', 'users'),
    /both foreign keys resolve to the column "user_id".*self-referential many-to-many/s,
  )
  // Two DIFFERENT tables that singularize to the same column collide too, but there the
  // `columns` override (distinct keys) resolves it.
  assert.throws(() => defineJoinTable('boxes', 'box'), /both foreign keys resolve to the column "box_id"/)
  const frag = defineJoinTable('boxes', 'box', { columns: { boxes: 'box_a', box: 'box_b' } })
  assert.deepEqual(frag.columns.map((c) => c.name).sort(), ['box_a', 'box_b'])
})

test('defineJoinTable options override name, FK columns, type and onDelete', () => {
  const frag = defineJoinTable('users', 'teams', {
    table: 'memberships',
    columns: { users: 'member_id' },
    type: 'integer',
    onDelete: 'restrict',
  })
  assert.equal(frag.table, 'memberships')
  const byName = Object.fromEntries(frag.columns.map((c) => [c.name, c]))
  assert.ok(byName.member_id) // overridden
  assert.ok(byName.team_id) // derived
  assert.equal(byName.member_id.type, 'integer')
  assert.equal(byName.member_id.onDelete, 'restrict')
  assert.deepEqual(frag.primaryKey, ['member_id', 'team_id'])
})

// ----------------------------------------------------- merge + relations ------

const m2m = () =>
  mergeSchemas([
    defineSchema('users', (t) => t.uuid('id').primary()),
    defineSchema('roles', (t) => t.uuid('id').primary()),
    defineJoinTable('users', 'roles'),
  ])

test('merge carries the composite PK onto the merged join table, no conflicts', () => {
  const { tables, conflicts } = m2m()
  assert.deepEqual(conflicts, [])
  const join = tables.find((t) => t.table === 'roles_users')
  assert.deepEqual(join.primaryKey, ['user_id', 'role_id'])
})

test('the join table FKs validate against both referenced tables', () => {
  // drop `roles` -> the role_id FK should be flagged as a dangling reference
  const { conflicts } = mergeSchemas([
    defineSchema('users', (t) => t.uuid('id').primary()),
    defineJoinTable('users', 'roles'),
  ])
  assert.ok(conflicts.some((c) => c.kind === 'unknown-reference-table' && c.target === 'roles'))
})

test('m2m derives two one-to-many legs (the many-to-many) through the join', () => {
  const { tables } = m2m()
  const rels = deriveRelations(tables)
  const join = rels.get('roles_users')
  assert.equal(join.forward.length, 2)
  assert.ok(join.forward.every((r) => r.toOne === false)) // non-unique FKs => many side
  // each parent sees the join on its inverse side
  assert.equal(rels.get('users').inverse.length, 1)
  assert.equal(rels.get('roles').inverse.length, 1)
})

// ------------------------------------------------------------- compilers ------

test('Prisma renders a composite PK as a block-level @@id, columns keep no @id', () => {
  const { tables } = m2m()
  const join = tables.find((t) => t.table === 'roles_users')
  const out = toPrisma(join, deriveRelations(tables).get('roles_users'))
  assert.match(out, /@@id\(\[user_id, role_id\]\)/)
  assert.ok(!/ @id\b/.test(out)) // no field-level @id on a composite-PK model
  assert.match(out, /@@map\("roles_users"\)/)
})

test('Drizzle renders a composite PK as the table-extra primaryKey() + imports it', () => {
  const { tables } = m2m()
  const join = tables.find((t) => t.table === 'roles_users')
  const out = toDrizzle(join)
  assert.match(out, /primaryKey\(\{ columns: \[table\.userId, table\.roleId\] \}\)/)
  assert.match(out, /import \{ pgTable, .*primaryKey.* \} from 'drizzle-orm\/pg-core'/)
})

test('Rudder renders a composite PK as a table-level t.primary([...])', () => {
  const { tables } = m2m()
  const join = tables.find((t) => t.table === 'roles_users')
  const out = toRudder(join)
  assert.match(out, /t\.primary\(\['user_id', 'role_id'\]\)/)
})

test('single-PK tables are unchanged: no @@id / table-extra / t.primary([...])', () => {
  const { tables } = mergeSchemas([defineSchema('users', (t) => t.uuid('id').primary())])
  const users = tables[0]
  assert.ok(!toPrisma(users).includes('@@id'))
  // the column-level `.primaryKey()` is expected; the composite table-extra is not
  assert.ok(!toDrizzle(users).includes('primaryKey({'))
  assert.ok(!/import \{ pgTable,[^}]*\bprimaryKey\b/.test(toDrizzle(users))) // not imported
  assert.ok(!toRudder(users).includes('t.primary(['))
})

// -------------------------------------------------------------- generate ------

test('the generated Drizzle file hoists the primaryKey import when a join exists', () => {
  const { tables } = m2m()
  const [{ contents }] = generateArtifacts({ tables }, 'drizzle')
  assert.match(contents, /import \{ pgTable, .*primaryKey.* \} from 'drizzle-orm\/pg-core'/)
  assert.match(contents, /export const rolesUsers = pgTable\('roles_users'/)
  // the helper is in the single hoisted import line exactly once
  assert.equal((contents.match(/^import .*\bprimaryKey\b/gm) || []).length, 1)
})

test('the generated Rudder migration for the join carries the composite PK', () => {
  const fragments = [
    defineSchema('users', (t) => t.uuid('id').primary()),
    defineSchema('roles', (t) => t.uuid('id').primary()),
    defineJoinTable('users', 'roles'),
  ]
  const files = generateArtifacts({ fragments }, 'rudder')
  const join = files.find((f) => f.path.includes('roles_users'))
  assert.match(join.contents, /t\.primary\(\['user_id', 'role_id'\]\)/)
})
