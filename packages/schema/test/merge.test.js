// The merge/derive core: resolve cumulative contributions into a flat fragment
// list, merge fragments into tables while detecting cross-extension conflicts,
// topologically order by FK, and derive relations + migration names.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema, extendSchema } from '../src/define.js'
import {
  resolveSchemas,
  dedupeFragments,
  orderFragments,
  mergeSchemas,
  deriveRelations,
  deriveMigrations,
} from '../src/merge.js'

const users = () => defineSchema('users', (t) => t.uuid('id').primary())
const orgs = () => defineSchema('organizations', (t) => t.uuid('id').primary())

// ---------------------------------------------------------- resolveSchemas ----

test('resolveSchemas flattens static array contributions', () => {
  const out = resolveSchemas([[users()], [orgs()]], {})
  assert.deepEqual(out.map((f) => f.table), ['users', 'organizations'])
})

test('resolveSchemas calls function (computed) contributions with the config', () => {
  let seen
  const computed = (config) => {
    seen = config
    return [defineSchema(config.keyBy, (t) => t.uuid('id').primary())]
  }
  const out = resolveSchemas([computed], { keyBy: 'tenants' })
  assert.deepEqual(seen, { keyBy: 'tenants' })
  assert.equal(out[0].table, 'tenants')
})

test('resolveSchemas tolerates null / empty contributions', () => {
  assert.deepEqual(resolveSchemas(undefined, {}), [])
  assert.deepEqual(resolveSchemas([null, () => null, []], {}), [])
})

test('resolveSchemas dedupes structurally-identical fragments', () => {
  const out = resolveSchemas([[users()], [users()]], {})
  assert.equal(out.length, 1)
})

// --------------------------------------------------------- dedupeFragments ----

test('dedupeFragments collapses identical fragments but keeps genuine variants', () => {
  const a = users()
  const b = users()
  const different = defineSchema('users', (t) => t.uuid('id').primary().unique())
  const out = dedupeFragments([a, b, different])
  assert.equal(out.length, 2) // a==b collapse; `different` survives
})

// ---------------------------------------------------------- orderFragments ----

test('orderFragments puts an FK target before its dependant', () => {
  // subscriptions -> organizations, contributed in the WRONG order.
  const subs = defineSchema('subscriptions', (t) => t.uuid('org_id').references('organizations'))
  const ordered = orderFragments([subs, orgs()])
  const names = ordered.map((f) => f.table)
  assert.ok(names.indexOf('organizations') < names.indexOf('subscriptions'))
})

test('orderFragments places an alter after its own table create', () => {
  const alter = extendSchema('users', (t) => t.string('nickname'))
  const ordered = orderFragments([alter, users()])
  const idx = ordered.map((f) => `${f.mode}:${f.table}`)
  assert.ok(idx.indexOf('create:users') < idx.indexOf('extend:users'))
})

test('orderFragments ignores self-references (no false cycle)', () => {
  const tree = defineSchema('nodes', (t) => {
    t.uuid('id').primary()
    t.uuid('parent_id').nullable().references('nodes.id')
  })
  const ordered = orderFragments([tree])
  assert.equal(ordered.length, 1)
})

test('orderFragments is stable for independent fragments', () => {
  const a = defineSchema('a', (t) => t.uuid('id').primary())
  const b = defineSchema('b', (t) => t.uuid('id').primary())
  assert.deepEqual(orderFragments([a, b]).map((f) => f.table), ['a', 'b'])
})

test('orderFragments never drops fragments on a residual cycle', () => {
  // A genuine create<->create cycle: fall back to original order, lose nothing.
  const a = defineSchema('a', (t) => t.uuid('b_id').references('b'))
  const b = defineSchema('b', (t) => t.uuid('a_id').references('a'))
  const ordered = orderFragments([a, b])
  assert.equal(ordered.length, 2)
})

// ------------------------------------------------------------ mergeSchemas ----

test('mergeSchemas merges creates + extends into one table', () => {
  const { tables, conflicts } = mergeSchemas([
    users(),
    extendSchema('users', (t) => t.string('nickname')),
  ])
  assert.equal(conflicts.length, 0)
  assert.deepEqual(tables[0].columns.map((c) => c.name), ['id', 'nickname'])
})

test('an extend marks its added columns', () => {
  const { tables } = mergeSchemas([users(), extendSchema('users', (t) => t.string('nickname'))])
  const nickname = tables[0].columns.find((c) => c.name === 'nickname')
  assert.equal(nickname.added, true)
})

test('mergeSchemas preserves a column semantic hint through composition', () => {
  const { tables } = mergeSchemas([
    defineSchema('docs', (t) => {
      t.uuid('id').primary()
      t.string('status').as('enum', { values: ['draft', 'published'] })
    }),
    extendSchema('docs', (t) => t.string('cover').as('file')),
  ])
  const cols = tables[0].columns
  assert.equal(cols.find((c) => c.name === 'status').semantic, 'enum')
  assert.deepEqual(cols.find((c) => c.name === 'status').semanticOptions, { values: ['draft', 'published'] })
  assert.equal(cols.find((c) => c.name === 'cover').semantic, 'file')
})

test('mergeSchemas flags a duplicate create of the same table', () => {
  const { conflicts } = mergeSchemas([users(), users()])
  assert.deepEqual(conflicts, [{ kind: 'duplicate-table', table: 'users' }])
})

test('mergeSchemas flags an extend of a table that does not exist', () => {
  const { conflicts } = mergeSchemas([extendSchema('ghost', (t) => t.string('x'))])
  assert.deepEqual(conflicts, [{ kind: 'extend-missing-table', table: 'ghost' }])
})

test('mergeSchemas flags an extend that EDITS an existing column', () => {
  const { conflicts } = mergeSchemas([users(), extendSchema('users', (t) => t.string('id'))])
  assert.deepEqual(conflicts, [{ kind: 'column-edit', table: 'users', column: 'id' }])
})

test('mergeSchemas flags a foreign key to an unknown table', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users'))
  const { conflicts } = mergeSchemas([posts])
  assert.deepEqual(conflicts, [
    { kind: 'unknown-reference-table', table: 'posts', column: 'author_id', target: 'users' },
  ])
})

test('mergeSchemas flags a foreign key to an unknown column', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.missing'))
  const { conflicts } = mergeSchemas([users(), posts])
  assert.deepEqual(conflicts, [
    { kind: 'unknown-reference-column', table: 'posts', column: 'author_id', target: 'users.missing' },
  ])
})

test('a valid cross-table foreign key produces no conflict', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.id'))
  const { conflicts } = mergeSchemas([users(), posts])
  assert.equal(conflicts.length, 0)
})

// --------------------------------------------------------- deriveRelations ----

const relGraph = () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.id', { onDelete: 'cascade' }))
  const { tables } = mergeSchemas([users(), posts])
  return deriveRelations(tables)
}

test('deriveRelations records a forward relation on the owner', () => {
  const [fwd] = relGraph().get('posts').forward
  assert.equal(fwd.name, 'posts_author_id')
  assert.equal(fwd.target, 'users')
  assert.equal(fwd.fkColumn, 'author_id')
  assert.equal(fwd.refColumn, 'id')
  assert.equal(fwd.onDelete, 'cascade')
})

test('the forward field name strips a trailing _id', () => {
  assert.equal(relGraph().get('posts').forward[0].fieldName, 'author')
})

test('deriveRelations records the inverse relation on the target', () => {
  const [inv] = relGraph().get('users').inverse
  assert.equal(inv.name, 'posts_author_id')
  assert.equal(inv.owner, 'posts')
})

test('a unique FK is one-to-one (toOne), a plain FK is one-to-many', () => {
  const oneToOne = defineSchema('profiles', (t) => t.uuid('user_id').unique().references('users.id'))
  const { tables } = mergeSchemas([users(), oneToOne])
  assert.equal(deriveRelations(tables).get('profiles').forward[0].toOne, true)
  assert.equal(relGraph().get('posts').forward[0].toOne, false)
})

test('a non-_id FK column gets a _ref field name', () => {
  const t1 = defineSchema('a', (t) => t.uuid('id').primary())
  const t2 = defineSchema('b', (t) => t.uuid('owner').references('a.id'))
  const { tables } = mergeSchemas([t1, t2])
  assert.equal(deriveRelations(tables).get('b').forward[0].fieldName, 'owner_ref')
})

// -------------------------------------------------------- deriveMigrations ----

test('deriveMigrations numbers and names creates + alters in order', () => {
  const names = deriveMigrations([
    users(),
    extendSchema('users', (t) => t.string('nickname')),
  ])
  assert.deepEqual(names, ['001_create_users_table', '002_alter_users_add_nickname'])
})

test('deriveMigrations dedupes a repeated create by table', () => {
  const names = deriveMigrations([users(), users(), orgs()])
  assert.deepEqual(names, ['001_create_users_table', '002_create_organizations_table'])
})

test('deriveMigrations joins multiple altered columns into one name', () => {
  const names = deriveMigrations([
    users(),
    extendSchema('users', (t) => {
      t.string('a')
      t.string('b')
    }),
  ])
  assert.equal(names[1], '002_alter_users_add_a_b')
})

// A fragment can arrive more than once across renders, so the merged table must OWN its
// table-level `primaryKey` / `foreignKeys` arrays (not share the input fragment's instances).
// Otherwise a later mutation of the merged table would corrupt the source fragment and every
// other merge that shares it (#143).
test('mergeSchemas does not share the primaryKey / foreignKeys arrays with the input fragment', () => {
  const assignments = defineSchema('assignments', (t) => {
    t.uuid('org_id')
    t.uuid('unit_id')
    t.primaryKey('org_id', 'unit_id')
    t.foreignKey(['org_id', 'unit_id'], 'org_units', ['org_id', 'unit_id'])
  })
  // org_units exists so the FK validates cleanly (referential check passes -> no conflicts).
  const orgUnits = defineSchema('org_units', (t) => {
    t.uuid('org_id')
    t.uuid('unit_id')
    t.primaryKey('org_id', 'unit_id')
  })

  const { tables, conflicts } = mergeSchemas([orgUnits, assignments])
  assert.deepEqual(conflicts, [])
  const merged = tables.find((t) => t.table === 'assignments')

  // Different array instances...
  assert.notEqual(merged.primaryKey, assignments.primaryKey)
  assert.notEqual(merged.foreignKeys, assignments.foreignKeys)
  assert.notEqual(merged.foreignKeys[0], assignments.foreignKeys[0])
  assert.notEqual(merged.foreignKeys[0].columns, assignments.foreignKeys[0].columns)
  assert.notEqual(merged.foreignKeys[0].references, assignments.foreignKeys[0].references)
  assert.notEqual(merged.foreignKeys[0].references.columns, assignments.foreignKeys[0].references.columns)

  // ...so mutating the merged table cannot bleed back into the source fragment.
  merged.primaryKey.push('leaked')
  merged.foreignKeys.push({ columns: ['x'], references: { table: 'y', columns: ['z'] } })
  merged.foreignKeys[0].columns.push('leaked')
  merged.foreignKeys[0].references.columns.push('leaked')
  assert.deepEqual(assignments.primaryKey, ['org_id', 'unit_id'])
  assert.equal(assignments.foreignKeys.length, 1)
  assert.deepEqual(assignments.foreignKeys[0].columns, ['org_id', 'unit_id'])
  assert.deepEqual(assignments.foreignKeys[0].references.columns, ['org_id', 'unit_id'])

  // ...and two independent merges of the same fragment do not alias each other.
  const second = mergeSchemas([orgUnits, assignments]).tables.find((t) => t.table === 'assignments')
  assert.deepEqual(second.primaryKey, ['org_id', 'unit_id'])
  assert.equal(second.foreignKeys.length, 1)
})
