// The memory adapter, exercised through the real repository (createRepository)
// over a composed schema. This is the same contract `@gemstack/orm-drizzle` is
// held to — the two adapters are interchangeable behind `db.<table>.<op>`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema, mergeSchemas } from '@gemstack/schema'
import { createRepository } from '@gemstack/orm'
import { createMemoryAdapter } from '../src/index.js'

function makeDb() {
  const { tables } = mergeSchemas([
    defineSchema('users', (t) => {
      t.uuid('id').primary()
      t.string('email').unique()
      t.string('name').nullable()
      t.boolean('active')
    }),
  ])
  return createRepository({ tables }, createMemoryAdapter())
}

test('insert + find round-trips, with equality and `in` filters', async () => {
  const db = makeDb()
  await db.users.insert({ id: 'u1', email: 'a@b.com', name: 'A', active: true })
  await db.users.insert({ id: 'u2', email: 'b@b.com', name: 'B', active: false })
  assert.equal((await db.users.find()).length, 2)
  assert.deepEqual((await db.users.find({ active: true })).map((r) => r.id), ['u1'])
  assert.deepEqual(
    (await db.users.find({ id: { in: ['u1', 'u2'] } })).map((r) => r.id).sort(),
    ['u1', 'u2'],
  )
})

test('findOne returns first match or null', async () => {
  const db = makeDb()
  assert.equal(await db.users.findOne({ id: 'x' }), null)
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  assert.equal((await db.users.findOne({ id: 'u1' })).email, 'a@b.com')
})

test('upsert inserts then updates the conflicting row in place', async () => {
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
  const updated = await db.users.update({ id: 'u1' }, { active: false })
  assert.deepEqual(updated.map((r) => r.active), [false])
})

test('delete removes matching rows and returns the count', async () => {
  const db = makeDb()
  await db.users.insert({ id: 'u1', email: 'a@b.com', active: true })
  await db.users.insert({ id: 'u2', email: 'b@b.com', active: false })
  assert.equal(await db.users.delete({ active: false }), 1)
  assert.deepEqual((await db.users.find()).map((r) => r.id), ['u1'])
})

test('rows are copied in and out (no shared mutable references)', async () => {
  const db = makeDb()
  const input = { id: 'u1', email: 'a@b.com', active: true }
  await db.users.insert(input)
  input.email = 'mutated@b.com' // mutating the caller's object must not affect the store
  const fetched = await db.users.findOne({ id: 'u1' })
  assert.equal(fetched.email, 'a@b.com')
  fetched.email = 'also-mutated' // mutating a returned row must not affect the store
  assert.equal((await db.users.findOne({ id: 'u1' })).email, 'a@b.com')
})

// Seed N users (a@, b@, c@... / A, B, C...) for the paging/order/count tests.
async function seedUsers(db, n) {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  for (let i = 0; i < n; i++) {
    await db.users.insert({ id: `u${i}`, email: `${letters[i]}@b.com`, name: letters[i].toUpperCase(), active: true })
  }
}

test('find orders by a column, ascending and descending', async () => {
  const db = makeDb()
  await seedUsers(db, 4)
  assert.deepEqual((await db.users.find({}, { orderBy: 'email' })).map((r) => r.id), ['u0', 'u1', 'u2', 'u3'])
  assert.deepEqual(
    (await db.users.find({}, { orderBy: { column: 'email', dir: 'desc' } })).map((r) => r.id),
    ['u3', 'u2', 'u1', 'u0'],
  )
})

test('find applies limit and offset (a page slice)', async () => {
  const db = makeDb()
  await seedUsers(db, 5)
  const page2 = await db.users.find({}, { orderBy: 'email', limit: 2, offset: 2 })
  assert.deepEqual(page2.map((r) => r.id), ['u2', 'u3'])
})

test('limit/offset compose with a filter', async () => {
  const db = makeDb()
  await seedUsers(db, 4)
  await db.users.insert({ id: 'x', email: 'z@b.com', name: 'Z', active: false })
  const rows = await db.users.find({ active: true }, { orderBy: { column: 'email', dir: 'desc' }, limit: 2 })
  assert.deepEqual(rows.map((r) => r.id), ['u3', 'u2'])
})

test('count returns the number of matching rows, honouring the filter', async () => {
  const db = makeDb()
  await seedUsers(db, 3)
  await db.users.insert({ id: 'x', email: 'z@b.com', name: 'Z', active: false })
  assert.equal(await db.users.count(), 4)
  assert.equal(await db.users.count({ active: true }), 3)
  assert.equal(await db.users.count({ active: false }), 1)
})
