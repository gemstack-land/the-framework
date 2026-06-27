# schema

::: warning Preview / experimental
`@gemstack/schema` is an early spike. The API is still settling and the per-ORM compilers emit *representative* output — they do not yet run against real databases. Use it to explore the shape of the data layer, not in production.
:::

`@gemstack/schema` is the **framework-agnostic core** of the data layer — the **shape** half, the twin of [`orm`](/packages/orm) (the runtime half). Zero framework imports, zero ORM imports.

You describe your tables **once** as plain, declarative data; this package merges contributions from independent sources, derives the migration order, and compiles the result to Prisma, Drizzle, or a Rudder-engine artifact.

```bash
npm install @gemstack/schema
```

## What's in the box

- **A neutral schema DSL** — `defineSchema` / `extendSchema`. No ORM imported; the result is plain data (an IR).
- **Merge + derive** — `mergeSchemas` folds creates and third-party column adds into final tables (and flags column-edit conflicts); `deriveMigrations` produces the ordered migration names from the contributions.
- **Relations / foreign keys** — declare an FK with `.references('table.column', { onDelete })`; `deriveRelations` computes both ends (forward + inverse) so ORMs that model navigation (Prisma relation fields, Drizzle `relations()`) get them. Self-references, per-FK relation-field naming (`as` / `inverseAs`), composite primary keys (`t.primaryKey(a, b)`), and many-to-many via `defineJoinTable(a, b)` are all supported.
- **Per-ORM compilers** — `toPrisma`, `toDrizzle`, `toRudder` (and the `COMPILERS` map) turn one merged table into that ORM's schema.
- **File generation** — `generateArtifacts({ tables, fragments }, orm)` returns `[{ path, contents }]` ready to write to disk, each with a "generated, don't edit" header. Pure: it performs no filesystem access itself.

## Usage

```js
import {
  defineSchema,
  extendSchema,
  defineJoinTable,
  mergeSchemas,
  deriveMigrations,
  generateArtifacts,
} from '@gemstack/schema'

// 1. Declare tables once (this is the source of truth).
const auth = defineSchema('users', (t) => {
  t.uuid('id').primary()
  t.string('email').unique()
  t.timestamps()
})

const roles = defineSchema('roles', (t) => {
  t.uuid('id').primary()
  t.string('name').unique()
})

// 2. A different source can ADD columns to a table it didn't create.
const billing = extendSchema('users', (t) => {
  t.string('stripe_customer_id').nullable()
})

// 3. Many-to-many is the join table that links two tables (two FKs + composite PK).
const userRoles = defineJoinTable('users', 'roles')
//   -> `roles_users` { user_id -> users.id, role_id -> roles.id, primaryKey(both) }

// 4. Merge + derive.
const fragments = [auth, roles, billing, userRoles]
const { tables, conflicts } = mergeSchemas(fragments)
const migrations = deriveMigrations(fragments)

// 5. Generate committable artifacts for the ORM of your choice.
const files = generateArtifacts({ tables, fragments }, 'prisma')
//   -> [{ path: 'prisma/schema.generated.prisma', contents: '// GENERATED ...' }]
```

## Design

- **Declarative (desired-state) is the right shape.** Prisma and Drizzle diff state, and the Rudder engine generates an ordered migration from it, so authoring desired state and deriving everything downstream fits all three.
- **Migrations are an output, not authored by hand.** Schema is the single source of truth; the ORM schema becomes generated output (the usual model, inverted).
- **Framework-free on purpose.** A framework binding (e.g. the Vike one, `@vike-data/vike-schema`) lives in a separate package; this core is the part meant to be reusable anywhere.

## Scope / deferred (the interesting hard parts)

- **Types:** `uuid` / `string` / `text` / `integer` / `boolean` / `timestamp` plus `nullable` / `unique` / `primary` / `default` / `timestamps()`.
- **Relations / foreign keys:** single-column FKs, `onDelete`, cross-source reference validation, self-references, relation-field naming, composite primary keys, and many-to-many sugar all ship. Still deferred: composite (multi-column) foreign keys, and one-to-one inference beyond a `unique` FK.
- **Type escape hatches:** DB-specific types (pg arrays, enums, JSON) want a per-adapter override so the neutral layer isn't lowest-common-denominator.
- **Declarative → ordered migration reconciliation:** real diffing/ordering.
- **Column-edit policy:** conflicts are detected; resolution is unspecified.
- Compilers emit representative artifacts; they don't run against real DBs yet.
