// Per-ORM compilers: the same neutral table IR -> each ORM's schema artifact.
// These pin the representative output (column types, modifiers, FK rendering).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineSchema } from '../src/define.js'
import { mergeSchemas, deriveRelations } from '../src/merge.js'
import { toPrisma, toDrizzle, toRudder, COMPILERS } from '../src/compilers.js'

const ir = (build) => mergeSchemas([defineSchema('users', build)]).tables[0]

// ------------------------------------------------------------------ Prisma ----

test('toPrisma maps types and the @id / @default(uuid()) primary key', () => {
  const out = toPrisma(ir((t) => t.uuid('id').primary()))
  assert.match(out, /id String @id @default\(uuid\(\)\)/)
  assert.match(out, /model Users \{/)
  assert.match(out, /@@map\("users"\)/)
})

test('.as() is a UI hint only — it never changes compiled output', () => {
  const plain = ir((t) => {
    t.string('email')
    t.string('status')
    t.text('bio')
  })
  const tagged = ir((t) => {
    t.string('email').as('email')
    t.string('status').as('enum', { values: ['a', 'b'] })
    t.text('bio').as('longtext')
  })
  assert.equal(toPrisma(tagged), toPrisma(plain))
  assert.equal(toDrizzle(tagged), toDrizzle(plain))
  assert.equal(toRudder(tagged), toRudder(plain))
})

test('toPrisma renders nullable, unique, now-default and text', () => {
  const out = toPrisma(
    ir((t) => {
      t.string('email').unique()
      t.text('bio').nullable()
      t.timestamp('created_at').default('now')
    }),
  )
  assert.match(out, /email String @unique/)
  assert.match(out, /bio String\? @db\.Text/)
  assert.match(out, /created_at DateTime @default\(now\(\)\)/)
})

test('toPrisma emits a forward relation field + scalar FK column with onDelete', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.id', { onDelete: 'cascade' }))
  const { tables } = mergeSchemas([defineSchema('users', (t) => t.uuid('id').primary()), posts])
  const rels = deriveRelations(tables)
  const out = toPrisma(tables.find((t) => t.table === 'posts'), rels.get('posts'))
  assert.match(out, /author_id String/) // scalar FK kept
  assert.match(out, /author Users @relation\("posts_author_id", fields: \[author_id\], references: \[id\], onDelete: Cascade\)/)
})

test('toPrisma emits an inverse relation field on the referenced model', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.id'))
  const { tables } = mergeSchemas([defineSchema('users', (t) => t.uuid('id').primary()), posts])
  const rels = deriveRelations(tables)
  const out = toPrisma(tables.find((t) => t.table === 'users'), rels.get('users'))
  assert.match(out, /posts_author_id Posts\[\] @relation\("posts_author_id"\)/)
})

// ----------------------------------------------------------------- Drizzle ----

test('toDrizzle builds a pgTable with camelCased columns and modifiers', () => {
  const out = toDrizzle(
    ir((t) => {
      t.uuid('id').primary()
      t.string('display_name') // columns are non-nullable by default
    }),
  )
  assert.match(out, /export const users = pgTable\('users', \{/)
  assert.match(out, /id: uuid\('id'\)\.primaryKey\(\)\.defaultRandom\(\)\.notNull\(\)/)
  assert.match(out, /displayName: varchar\('display_name', \{ length: 255 \}\)/)
})

test("toDrizzle renders timestamp columns with mode: 'string' (universal-orm speaks ISO strings)", () => {
  const out = toDrizzle(
    ir((t) => {
      t.uuid('id').primary()
      t.timestamp('created_at').default('now')
      t.timestamp('expires_at')
    }),
  )
  assert.match(out, /createdAt: timestamp\('created_at', \{ mode: 'string' \}\)\.notNull\(\)\.defaultNow\(\)/)
  assert.match(out, /expiresAt: timestamp\('expires_at', \{ mode: 'string' \}\)\.notNull\(\)/)
})

test('toDrizzle renders a column FK as a lazy .references thunk with onDelete', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.id', { onDelete: 'cascade' }))
  const out = toDrizzle(mergeSchemas([defineSchema('users', (t) => t.uuid('id').primary()), posts]).tables.find((t) => t.table === 'posts'))
  assert.match(out, /authorId: uuid\('author_id'\)\.notNull\(\)\.references\(\(\) => users\.id, \{ onDelete: 'cascade' \}\)/)
})

// ----------------------------------------------------------------- Rudder ----

test('toRudder emits a Schema.create migration class', () => {
  const out = toRudder(ir((t) => t.uuid('id').primary()))
  assert.match(out, /import \{ Migration, Schema \} from '@rudderjs\/database'/)
  assert.match(out, /await Schema\.create\('users', \(t\) => \{/)
  assert.match(out, /t\.uuid\('id'\)\.primary\(\)/)
})

test('toRudder renders an inline FK constraint with onDelete', () => {
  const posts = defineSchema('posts', (t) => t.uuid('author_id').references('users.id', { onDelete: 'restrict' }))
  const out = toRudder(mergeSchemas([defineSchema('users', (t) => t.uuid('id').primary()), posts]).tables.find((t) => t.table === 'posts'))
  assert.match(out, /t\.uuid\('author_id'\)\.references\('id'\)\.on\('users'\)\.onDelete\('restrict'\)/)
})

// -------------------------------------------------------------- COMPILERS map -

test('COMPILERS exposes all three compilers by ORM key', () => {
  assert.equal(COMPILERS.prisma, toPrisma)
  assert.equal(COMPILERS.drizzle, toDrizzle)
  assert.equal(COMPILERS.rudder, toRudder)
})
