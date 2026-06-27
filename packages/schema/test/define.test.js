// The declarative DSL: defineSchema/extendSchema build plain-data fragments.
// These tests pin the shape of a fragment + every column modifier, since the
// merge/compiler layers all read this structure.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema, extendSchema } from '../src/define.js'

test('defineSchema produces a create fragment with the table name', () => {
  const f = defineSchema('users', (t) => t.uuid('id').primary())
  assert.equal(f.mode, 'create')
  assert.equal(f.table, 'users')
  assert.equal(f.columns.length, 1)
})

test('extendSchema produces an extend fragment', () => {
  const f = extendSchema('users', (t) => t.string('nickname').nullable())
  assert.equal(f.mode, 'extend')
  assert.equal(f.table, 'users')
})

test('a fresh column has explicit, defaulted flags', () => {
  const [c] = defineSchema('t', (t) => t.string('name')).columns
  assert.deepEqual(c, {
    name: 'name',
    type: 'string',
    nullable: false,
    unique: false,
    primary: false,
    default: undefined,
  })
})

test('modifiers chain and mutate the column', () => {
  const [c] = defineSchema('t', (t) => t.uuid('id').primary().unique()).columns
  assert.equal(c.primary, true)
  assert.equal(c.unique, true)
})

test('.nullable() and .default() set their fields', () => {
  const [c] = defineSchema('t', (t) => t.integer('age').nullable().default(0)).columns
  assert.equal(c.nullable, true)
  assert.equal(c.default, 0)
})

test('every column type maps to its IR type tag', () => {
  const { columns } = defineSchema('t', (t) => {
    t.uuid('a')
    t.string('b')
    t.text('c')
    t.integer('d')
    t.boolean('e')
    t.timestamp('f')
  })
  assert.deepEqual(
    columns.map((c) => c.type),
    ['uuid', 'string', 'text', 'integer', 'boolean', 'timestamp'],
  )
})

test('timestamps() sugar adds created_at + updated_at defaulting to now', () => {
  const { columns } = defineSchema('t', (t) => t.timestamps())
  assert.deepEqual(
    columns.map((c) => [c.name, c.type, c.default]),
    [
      ['created_at', 'timestamp', 'now'],
      ['updated_at', 'timestamp', 'now'],
    ],
  )
})

test('timestamps({ updatedAt: false }) adds created_at only (append-only row)', () => {
  const { columns } = defineSchema('event__log', (t) => t.timestamps({ updatedAt: false }))
  assert.deepEqual(
    columns.map((c) => [c.name, c.type, c.default]),
    [['created_at', 'timestamp', 'now']],
  )
})

test('references("table") defaults the target column to id', () => {
  const [c] = defineSchema('posts', (t) => t.uuid('author_id').references('users')).columns
  assert.deepEqual(c.references, { table: 'users', column: 'id' })
})

test('references("table.column") parses an explicit target column', () => {
  const [c] = defineSchema('posts', (t) => t.uuid('author').references('users.uuid')).columns
  assert.deepEqual(c.references, { table: 'users', column: 'uuid' })
})

test('references() onDelete option records the referential action', () => {
  const [c] = defineSchema('posts', (t) =>
    t.uuid('author_id').references('users.id', { onDelete: 'cascade' }),
  ).columns
  assert.equal(c.onDelete, 'cascade')
})

test('.onDelete() modifier sets the action independently', () => {
  const [c] = defineSchema('posts', (t) => t.uuid('author_id').references('users').onDelete('set null')).columns
  assert.equal(c.onDelete, 'set null')
})

test('.as(semantic) tags the column without changing its storage type', () => {
  const [c] = defineSchema('t', (t) => t.string('email').as('email')).columns
  assert.equal(c.type, 'string')
  assert.equal(c.semantic, 'email')
})

test('.as() carries per-semantic options (enum values) and chains', () => {
  const [c] = defineSchema('t', (t) =>
    t.string('status').as('enum', { values: ['draft', 'published'] }).nullable(),
  ).columns
  assert.equal(c.semantic, 'enum')
  assert.deepEqual(c.semanticOptions, { values: ['draft', 'published'] })
  assert.equal(c.nullable, true)
})

test('a column without .as() has no semantic field (fresh shape unchanged)', () => {
  const [c] = defineSchema('t', (t) => t.string('name')).columns
  assert.ok(!('semantic' in c))
  assert.ok(!('semanticOptions' in c))
})

test('.as() with no options omits semanticOptions entirely', () => {
  const [c] = defineSchema('t', (t) => t.text('bio').as('longtext')).columns
  assert.equal(c.semantic, 'longtext')
  assert.ok(!('semanticOptions' in c))
})

test('.as() rejects a non-string / empty semantic type', () => {
  assert.throws(() => defineSchema('t', (t) => t.string('x').as('')), /non-empty string/)
  assert.throws(() => defineSchema('t', (t) => t.string('x').as(42)), /non-empty string/)
})
