// The neutral, ORM-agnostic runtime data surface (#45) — the runtime twin of
// universal-schema. An extension declares its tables ONCE with the schema DSL
// (defineSchema/extendSchema) and reads/writes them through `db.<table>.<op>(...)`
// here, never importing an ORM. A per-ORM ADAPTER (#46) executes the calls against
// the app's database; the SAME `db` runs on the memory adapter (tests/demo) or
// `@gemstack/orm-drizzle` (real) unchanged. Same shape as `@universal-middleware/*`:
// the app installs one adapter, extensions stay ORM-free.
//
// The surface is NARROW on purpose (#44): insert / find / findOne / count /
// upsert / update / delete with simple equality + `in` filters (see ./filter.js)
// and simple limit / offset / orderBy paging (see ./list.js). Joins, aggregates
// and raw SQL are out — drop to the underlying ORM for those.
//
// `schema` is the MERGED schema (the output of universal-schema's mergeSchemas):
// `{ tables: [{ table, columns: [{ name, ... }] }] }`. Tables and their columns
// come from that single source, so the surface stays consistent with — and
// typeable from — the same schema the ORM artifacts are generated from.

// The operations an adapter must implement. Each takes the table NAME first, so a
// single adapter instance serves every table in the composed schema:
//
//   insert(table, row)                       -> the inserted row
//   find(table, filter, opts)                -> matching rows (array); opts = { limit, offset, orderBy }
//   count(table, filter)                     -> number of matching rows (for paging)
//   upsert(table, row, { onConflict })       -> the upserted row
//   update(table, filter, patch)             -> the updated rows (array)
//   delete(table, filter)                    -> number of rows deleted
//
// `find`'s `opts` is optional — an adapter that ignores it still returns all
// matching rows, so paging degrades gracefully. `findOne` is NOT an adapter op —
// the core derives it from `find` (with `limit: 1`).
export const ADAPTER_OPS = ['insert', 'find', 'count', 'upsert', 'update', 'delete']

import { normalizeOrderBy, asCount } from './list.js'

// Property names that must NOT be treated as table lookups, so the returned `db`
// behaves like a normal (non-thenable) object: `await db`, structured-clone and
// console inspection probe these and must get `undefined`, not a "no such table"
// throw.
const RESERVED = new Set(['then', 'catch', 'finally', 'toJSON', 'constructor'])

export function createRepository(schema, adapter) {
  const tables = new Map((schema?.tables ?? []).map((t) => [t.table, t]))
  if (tables.size === 0) throw new Error('createRepository: schema has no tables')
  for (const op of ADAPTER_OPS) {
    if (typeof adapter?.[op] !== 'function') {
      throw new Error(`createRepository: adapter is missing the "${op}" operation`)
    }
  }

  const columnsOf = (table) => new Set(tables.get(table).columns.map((c) => c.name))

  // Reject unknown columns in a row/filter/patch up front. The schema is the
  // single source of truth, so a typo'd column ('emial') is a clear error here
  // rather than a silent no-op or a deep ORM error later.
  const assertColumns = (table, obj, what) => {
    if (!obj) return
    const known = columnsOf(table)
    for (const key of Object.keys(obj)) {
      if (!known.has(key)) throw new Error(`${table}.${what}: unknown column "${key}"`)
    }
  }

  const repoFor = (table) => ({
    insert(row) {
      assertColumns(table, row, 'insert')
      return adapter.insert(table, row)
    },
    find(filter = {}, opts = {}) {
      assertColumns(table, filter, 'find')
      // Validate orderBy columns against the schema too (a typo'd sort column is
      // an error, not a silent no-op), then pass the normalized opts to the adapter.
      const orderBy = normalizeOrderBy(opts.orderBy)
      assertColumns(table, Object.fromEntries(orderBy.map((o) => [o.column, true])), 'find orderBy')
      // Coerce limit/offset HERE (not only in the in-process applyListOpts) so a SQL
      // adapter, which builds LIMIT/OFFSET straight from opts, is guarded against a
      // negative or non-integer value (e.g. a bad `?page=`) just like the memory one.
      const limit = asCount(opts.limit, 'limit')
      const offset = asCount(opts.offset, 'offset')
      return adapter.find(table, filter, { ...opts, orderBy, limit, offset })
    },
    async findOne(filter = {}, opts = {}) {
      // Only one row is needed, so cap the adapter at 1 (cheaper on SQL adapters).
      const rows = await this.find(filter, { ...opts, limit: 1 })
      return rows[0] ?? null
    },
    count(filter = {}) {
      assertColumns(table, filter, 'count')
      return adapter.count(table, filter)
    },
    upsert(row, opts = {}) {
      assertColumns(table, row, 'upsert')
      // Normalize onConflict to an array of column names (accepts a string too).
      const onConflict = opts.onConflict == null ? undefined : [].concat(opts.onConflict)
      if (onConflict) assertColumns(table, Object.fromEntries(onConflict.map((c) => [c, true])), 'upsert onConflict')
      return adapter.upsert(table, row, { onConflict })
    },
    update(filter, patch) {
      assertColumns(table, filter, 'update filter')
      assertColumns(table, patch, 'update patch')
      return adapter.update(table, filter, patch)
    },
    delete(filter = {}) {
      assertColumns(table, filter, 'delete')
      return adapter.delete(table, filter)
    },
  })

  const repos = new Map()
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string' || RESERVED.has(prop)) return undefined
        if (!tables.has(prop)) {
          throw new Error(`db.${prop}: no table "${prop}" in the composed schema`)
        }
        if (!repos.has(prop)) repos.set(prop, repoFor(prop))
        return repos.get(prop)
      },
    },
  )
}
