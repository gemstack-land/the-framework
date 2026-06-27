# orm

`@gemstack/orm` is the **runtime** half of the data layer: how code reads and writes its data **without importing an ORM**. It is the runtime twin of [`schema`](/packages/schema) (the shape half) — you declare your tables once with the schema DSL, then talk to a neutral repository, and a per-ORM **adapter** executes the calls against the real database.

```bash
npm install @gemstack/orm
```

Zero framework imports, zero ORM imports. Usable standalone by any framework or ORM.

## The surface is narrow on purpose

```js
db.users.insert(row)                        // -> inserted row
db.users.find(filter)                       // -> matching rows (array)
db.users.findOne(filter)                    // -> first match | null
db.users.upsert(row, { onConflict })        // -> upserted row
db.users.update(filter, patch)              // -> updated rows (array)
db.users.delete(filter)                     // -> number of rows deleted
```

Filters are simple **equality** or **`in`** conditions — nothing more:

```js
db.users.find({ active: true })             // equality
db.users.find({ id: { in: ['u1', 'u2'] } }) // membership
db.users.find()                             // all rows
```

Joins, aggregates, ranges, raw SQL — deliberately **out of scope**. Drop to the underlying ORM for those, the same escape hatch as DB-specific column types. This is not a query language (that is Kysely's job); it is the 90%-case repository.

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

Tables and their columns come from the **merged schema** (the output of `mergeSchemas`), the same single source the ORM artifacts are generated from. A typo'd column or an unknown table is a clear error, not a silent no-op.

## The adapter contract

The app installs **one** adapter and hands it the connection; consumers never import an ORM. An adapter implements six operations, each taking the table **name** first:

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

In-process adapters can reuse the shared filter matcher so every adapter agrees on what a filter means; SQL adapters translate the same shape into a `WHERE` clause:

```js
import { matchesFilter } from '@gemstack/orm'
matchesFilter(row, { active: true })
```

> No transactions yet: the common operation is a single (atomic) upsert.

## The adapter registry: one adapter, every consumer

So the **app picks the backend once** and everything routes through it, the core holds a tiny runtime registry. The app calls `setAdapter(...)` at server start; each consumer reads the same adapter via `getAdapter()` and builds its repository over its own schema. Nothing hardcodes a backend, and nothing imports an ORM.

```js
// the app, once at server start:
import { setAdapter } from '@gemstack/orm'
import { createDrizzleAdapter } from '@gemstack/orm-drizzle'
setAdapter(createDrizzleAdapter(drizzle(pool), schema)) // or createMemoryAdapter()

// a consumer, anywhere:
import { getAdapter, createRepository } from '@gemstack/orm'
import { createMemoryAdapter } from '@gemstack/orm-memory'
const adapter = getAdapter() ?? createMemoryAdapter() // app's choice, else zero-config memory
const db = createRepository({ tables }, adapter)
```

`getAdapter()` returns `null` until the app sets one, so a consumer falls back to the memory adapter for zero-config dev/demo. `setAdapter` validates the six-op contract up front, and the registry is cached on `globalThis` so pointer-import / HMR double-eval can't fork it. `clearAdapter()` resets it (tests).

## Adapters

The repository is backend-agnostic; an adapter binds it to a real store. Two ship today:

| Package | Backend | Use it for |
|---|---|---|
| [`orm-memory`](/packages/orm) (`@gemstack/orm-memory`) | plain in-process `Map`s | tests, demos, zero-config dev — no database |
| [`orm-drizzle`](/packages/orm) (`@gemstack/orm-drizzle`) | [Drizzle](https://orm.drizzle.team) over your connection | real databases (Postgres, etc.) |

`orm-memory` reuses the core filter matcher, so it agrees with SQL adapters on what a filter means — the proof that the contract, not the backend, defines behavior. `orm-drizzle` declares `drizzle-orm` as a peer dependency.

Authoring your own adapter is just implementing the six-op contract above.
