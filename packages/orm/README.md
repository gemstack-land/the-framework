# @gemstack/orm

The **runtime** half of the data layer: how an extension reads and writes its data
**without importing an ORM**. It is the runtime twin of
[`@gemstack/schema`](../schema) (the shape half) and the
missing member of the `universal-*` family:

| Universal layer | One ... | runs on any ... |
|---|---|---|
| `universal-middleware` | request handler | server (Hono / Express / CF) |
| `universal-schema` | schema (DDL — the shape) | ORM (Prisma / Drizzle / Rudder) |
| **`universal-orm`** | repository call (DML — the data) | ORM |

An extension declares its tables once with the schema DSL, then talks to a neutral
repository. A per-ORM **adapter** executes the calls against the app's database.
`vike-stripe` just does `db.subscriptions.upsert(...)` — no ORM import.

## The surface is narrow on purpose

```js
db.users.insert(row)                       // -> inserted row
db.users.find(filter)                      // -> matching rows (array)
db.users.findOne(filter)                   // -> first match | null
db.users.upsert(row, { onConflict })       // -> upserted row
db.users.update(filter, patch)             // -> updated rows (array)
db.users.delete(filter)                    // -> number of rows deleted
```

Filters are simple **equality** or **`in`** conditions — nothing more:

```js
db.users.find({ active: true })            // equality
db.users.find({ id: { in: ['u1', 'u2'] } })// membership
db.users.find()                            // all rows
```

Joins, aggregates, ranges, raw SQL — deliberately **out of scope**. Drop to the
underlying ORM for those, the same escape hatch as DB-specific column types. This
is not a query language (that is Kysely's job); it is the 90%-case repository.

## Using it

```js
import { createRepository } from '@gemstack/orm'
import { defineSchema, mergeSchemas } from '@gemstack/schema'

const { tables } = mergeSchemas([
  defineSchema('users', (t) => {
    t.uuid('id').primary()
    t.string('email').unique()
    t.boolean('active')
  }),
])

const db = createRepository({ tables }, adapter) // adapter: see below
await db.users.upsert({ id: 'u1', email: 'a@b.com', active: true }, { onConflict: 'email' })
```

Tables and their columns come from the **merged schema** (the output of
`mergeSchemas`), the same single source the ORM artifacts are generated from. A
typo'd column or an unknown table is a clear error, not a silent no-op.

## The adapter contract

The app installs **one** adapter and hands it the connection; extensions never
import an ORM (same shape as `@universal-middleware/*`). An adapter implements six
operations, each taking the table **name** first:

```js
const adapter = {
  insert(table, row),                  // -> inserted row
  find(table, filter, opts),           // -> rows[]   (opts: { limit, offset, orderBy })
  count(table, filter),                // -> number of matching rows
  upsert(table, row, { onConflict }),  // -> upserted row (onConflict: column names)
  update(table, filter, patch),        // -> updated rows[]
  delete(table, filter),               // -> number deleted
}
```

`findOne` is not an adapter op; the repository derives it from `find` (with `limit: 1`).

In-process adapters can reuse the shared filter matcher so every adapter agrees on
what a filter means; SQL adapters translate the same shape into a `WHERE` clause:

```js
import { matchesFilter } from '@gemstack/orm'
matchesFilter(row, { active: true })
```

The shippable adapters — an in-memory one for tests/demos and
`@gemstack/orm-drizzle` for real — are tracked in
[#46](https://github.com/suliemandev/vike-data/issues/46). No transactions yet: the
common operation is a single (atomic) upsert.

## The adapter registry: one adapter, every extension

So the **app picks the backend once** and every extension routes through it, the
core holds a tiny runtime registry. The app calls `setAdapter(...)` at server start;
each extension reads the same adapter via `getAdapter()` and builds its repository
over its own schema. No extension hardcodes a backend, and none imports an ORM.

```js
// the app, once at server start:
import { setAdapter } from '@gemstack/orm'
import { createDrizzleAdapter } from '@gemstack/orm-drizzle'
setAdapter(createDrizzleAdapter(drizzle(pool), schema)) // or createMemoryAdapter()

// an extension, anywhere:
import { getAdapter, createRepository } from '@gemstack/orm'
import { createMemoryAdapter } from '@gemstack/orm-memory'
const adapter = getAdapter() ?? createMemoryAdapter() // app's choice, else zero-config memory
const db = createRepository({ tables }, adapter)
```

`getAdapter()` returns `null` until the app sets one, so an extension falls back to
the memory adapter for zero-config dev/demo/proof. `setAdapter` validates the six-op
contract up front, and the registry is cached on `globalThis` so pointer-import / HMR
double-eval can't fork it. `clearAdapter()` resets it (tests).

> **Zero Vike, zero ORM imports.** Usable standalone by any framework or ORM.
