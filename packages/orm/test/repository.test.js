// The narrow repository contract (#45), exercised over a REAL composed schema
// (built with universal-schema's defineSchema + mergeSchemas) on the test memory
// adapter. This pins the surface every adapter (#46) must satisfy.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema, mergeSchemas } from '@gemstack/schema'
import { createRepository } from '../src/index.js'
import { createMemoryAdapter } from './memory-adapter.js'

// A small two-table schema, merged exactly as a binding would hand it over.
function makeDb() {
  const { tables } = mergeSchemas([
    defineSchema('users', (t) => {
      t.uuid('id').primary()
      t.string('email').unique()
      t.string('name').nullable()
      t.boolean('active')
    }),
    defineSchema('posts', (t) => {
      t.uuid('id').primary()
      t.uuid('author_id').references('users.id')
      t.string('title')
    }),
  ])
  return createRepository({ tables }, createMemoryAdapter())
}

test('createRepository validates schema and adapter', () => {
  const adapter = createMemoryAdapter()
  assert.throws(() => createRepository({ tables: [] }, adapter), /no tables/)
  assert.throws(() => createRepository(undefined, adapter), /no tables/)

  const schema = { tables: [{ table: 'users', columns: [{ name: 'id' }] }] }
  assert.throws(() => createRepository(schema, { insert() {} }), /missing the "find" operation/)
})

test('insert then find round-trips a row', async () => {
  const db = makeDb()
  const u = await db.users.insert({ id: 'u1', email: 'a@b.com', name: 'A', active: true })
  assert.deepEqual(u, { id: 'u1', email: 'a@b.com', name: 'A', active: true })
  assert.deepEqual(await db.users.find(), [u])
  assert.deepEqual(await db.users.find({ email: 'a@b.com' }), [u])
  assert.deepEqual(await db.users.find({ email: 'nobody@b.com' }), [])
})

test('find supports the `in` filter form', async () => {
  const db = makeDb()
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  await db.users.insert({ id: 'u2', email: 'b@b.com', active: true })
  await db.users.insert({ id: 'u3', email: 'c@b.com', active: false })
  const found = await db.users.find({ id: { in: ['u1', 'u3'] } })
  assert.deepEqual(found.map((r) => r.id).sort(), ['u1', 'u3'])
})

test('findOne returns the first match or null', async () => {
  const db = makeDb()
  assert.equal(await db.users.findOne({ id: 'missing' }), null)
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  assert.equal((await db.users.findOne({ id: 'u1' })).email, 'a@b.com')
})

test('upsert inserts, then updates the conflicting row in place', async () => {
  const db = makeDb()
  await db.users.upsert({ id: 'u1', email: 'a@b.com', name: 'A', active: true }, { onConflict: 'email' })
  await db.users.upsert({ id: 'u1', email: 'a@b.com', name: 'A2', active: true }, { onConflict: 'email' })
  const all = await db.users.find()
  assert.equal(all.length, 1)
  assert.equal(all[0].name, 'A2')
})

test('update patches matching rows and returns them', async () => {
  const db = makeDb()
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  await db.users.insert({ id: 'u2', email: 'b@b.com', active: true })
  const updated = await db.users.update({ id: 'u1' }, { active: false })
  assert.equal(updated.length, 1)
  assert.equal(updated[0].active, false)
  assert.equal((await db.users.findOne({ id: 'u2' })).active, true)
})

test('delete removes matching rows and returns the count', async () => {
  const db = makeDb()
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  await db.users.insert({ id: 'u2', email: 'b@b.com', active: false })
  assert.equal(await db.users.delete({ active: false }), 1)
  assert.deepEqual((await db.users.find()).map((r) => r.id), ['u1'])
})

test('unknown table throws a clear error', () => {
  const db = makeDb()
  assert.throws(() => db.comments, /no table "comments" in the composed schema/)
})

test('unknown column in a row/filter/patch throws (fail-fast, synchronous)', () => {
  const db = makeDb()
  assert.throws(() => db.users.insert({ id: 'u1', emial: 'typo' }), /unknown column "emial"/)
  assert.throws(() => db.users.find({ nope: 1 }), /unknown column "nope"/)
  assert.throws(() => db.users.update({ id: 'u1' }, { bogus: 1 }), /update patch: unknown column "bogus"/)
})

test('the db handle is a plain, non-thenable object', () => {
  const db = makeDb()
  // Probing thenable/inspection props must not throw "no such table".
  assert.equal(db.then, undefined)
  assert.equal(db.toJSON, undefined)
})

test('find threads limit/offset/orderBy to the adapter', async () => {
  const db = makeDb()
  for (const id of ['u3', 'u1', 'u2']) await db.users.insert({ id, email: `${id}@b.com`, active: true })
  const page = await db.users.find({}, { orderBy: { column: 'id', dir: 'asc' }, limit: 1, offset: 1 })
  assert.deepEqual(page.map((r) => r.id), ['u2'])
})

test('find validates limit/offset at the repository (so SQL adapters are guarded too)', async () => {
  // Regression: the negative/non-integer guard lived only in the in-process applyListOpts,
  // so a SQL adapter would get a raw bad value (e.g. a bad `?page=`). Coercing in find()
  // makes every adapter reject it the same way.
  const db = makeDb()
  assert.throws(() => db.users.find({}, { limit: -1 }), /limit: expected a non-negative integer/)
  assert.throws(() => db.users.find({}, { offset: 1.5 }), /offset: expected a non-negative integer/)
  assert.deepEqual(await db.users.find({}, { limit: 0 }), []) // 0 is valid -> no rows
})

test('findOne orders then takes the first (orderBy honoured)', async () => {
  const db = makeDb()
  for (const id of ['u3', 'u1', 'u2']) await db.users.insert({ id, email: `${id}@b.com`, active: true })
  assert.equal((await db.users.findOne({}, { orderBy: { column: 'id', dir: 'desc' } })).id, 'u3')
})

test('orderBy on an unknown column throws (fail-fast)', () => {
  const db = makeDb()
  assert.throws(() => db.users.find({}, { orderBy: 'nope' }), /find orderBy: unknown column "nope"/)
})

test('orderBy with an invalid direction throws', () => {
  const db = makeDb()
  assert.throws(() => db.users.find({}, { orderBy: { column: 'id', dir: 'sideways' } }), /invalid direction "sideways"/)
})

test('count returns the number of matching rows', async () => {
  const db = makeDb()
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  await db.users.insert({ id: 'u2', email: 'b@b.com', active: false })
  assert.equal(await db.users.count(), 2)
  assert.equal(await db.users.count({ active: true }), 1)
})

test('an adapter missing count fails createRepository', () => {
  const schema = { tables: [{ table: 'users', columns: [{ name: 'id' }] }] }
  const partial = { insert() {}, find() {}, upsert() {}, update() {}, delete() {} }
  assert.throws(() => createRepository(schema, partial), /missing the "count" operation/)
})
