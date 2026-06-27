// The Drizzle adapter (#46): the REAL glue that runs the neutral universal-orm
// operations against a Drizzle connection. The app constructs its Drizzle `db` and
// hands it here together with the generated Drizzle tables; extensions keep calling
// `db.<table>.<op>` and never import an ORM. Same shape as `@universal-middleware/*`:
// one adapter, installed by the app.
//
//   import { drizzle } from 'drizzle-orm/node-postgres'
//   import * as schema from './drizzle/schema.generated.ts'
//   const adapter = createDrizzleAdapter(drizzle(pool), schema)
//
// The one real translation problem this solves: universal-orm speaks the SCHEMA's
// column names (snake_case, e.g. `password_hash`), while a Drizzle table is keyed by
// JS PROPERTY names (camelCase, e.g. `passwordHash`). For each table we read
// `getTableColumns`, whose entries are `[propKey, column]` with `column.name` the DB
// name, and build the maps to translate rows in (name -> prop) and out (prop -> name).
// Filters/where-clauses are built from the column OBJECTS, so they are dialect-correct.

import { getTableColumns, getTableName, eq, isNull, inArray, and, asc, desc, count } from 'drizzle-orm'
import { normalizeOrderBy, isInCondition } from '@gemstack/orm'

// Per-table name<->property maps + the column objects used to build WHERE clauses.
function metaOf(table) {
  const byName = {} // DB column name -> Drizzle column object (for eq/inArray)
  const nameToProp = {} // DB column name -> JS property key (for .values()/.set())
  const propToName = {} // JS property key -> DB column name (for mapping rows back)
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    byName[col.name] = col
    nameToProp[col.name] = prop
    propToName[prop] = col.name
  }
  return { byName, nameToProp, propToName }
}

export function createDrizzleAdapter(db, tables) {
  // `tables` may be an array of Drizzle tables (keyed by their SQL name) or an
  // object map of neutral-name -> table (e.g. `import * as schema`).
  const entries = Array.isArray(tables)
    ? tables.map((t) => [getTableName(t), t])
    : Object.entries(tables)
  const registry = new Map(entries.map(([name, table]) => [name, { table, meta: metaOf(table) }]))

  const resolve = (name) => {
    const entry = registry.get(name)
    if (!entry) throw new Error(`@gemstack/orm-drizzle: no Drizzle table registered for "${name}"`)
    return entry
  }

  // Resolve a neutral DB-name to its Drizzle column object (for eq/inArray/orderBy/
  // onConflict), throwing a clear, role-specific error on a typo. `role` names the
  // role in the error (e.g. 'orderBy ', 'conflict ') so the message points at the
  // exact place the unknown column came from.
  const columnOf = (meta, name, role = '') => {
    const col = meta.byName[name]
    if (!col) throw new Error(`@gemstack/orm-drizzle: unknown ${role}column "${name}"`)
    return col
  }

  // Translate a neutral row/patch (DB-name keys) into Drizzle input (property keys).
  const toInput = (obj, meta) =>
    Object.fromEntries(
      Object.entries(obj).map(([name, value]) => {
        const prop = meta.nameToProp[name]
        if (!prop) throw new Error(`@gemstack/orm-drizzle: unknown column "${name}"`)
        return [prop, value]
      }),
    )

  // Translate a Drizzle result row (property keys) back to the neutral shape (DB names).
  const fromRow = (row, meta) =>
    Object.fromEntries(Object.entries(row).map(([prop, value]) => [meta.propToName[prop] ?? prop, value]))

  // Build a WHERE clause from a neutral filter. Equality + `in` only — the same
  // narrow surface the memory adapter honours. Empty filter => no WHERE (all rows).
  // `{ col: null }` is IS NULL, not `col = NULL` (which is UNKNOWN and matches no
  // row): the in-process matcher treats `null` as equality against a null column,
  // so the SQL adapters must too, or the soft-delete read `find({ deleted_at: null })`
  // silently returns zero rows here while working on memory/rudder.
  const whereOf = (filter, meta) => {
    const conds = []
    for (const [name, cond] of Object.entries(filter ?? {})) {
      const col = columnOf(meta, name)
      conds.push(isInCondition(cond) ? inArray(col, cond.in) : cond === null ? isNull(col) : eq(col, cond))
    }
    return conds.length ? and(...conds) : undefined
  }

  return {
    async insert(table, row) {
      const { table: t, meta } = resolve(table)
      const [r] = await db.insert(t).values(toInput(row, meta)).returning()
      return fromRow(r, meta)
    },

    async find(table, filter, opts = {}) {
      const { table: t, meta } = resolve(table)
      const where = whereOf(filter, meta)
      // Build incrementally: where -> orderBy -> limit -> offset, so a query with
      // none of them is byte-for-byte the original "select all" path.
      let query = db.select().from(t)
      if (where) query = query.where(where)
      const order = normalizeOrderBy(opts.orderBy)
      if (order.length) {
        query = query.orderBy(
          ...order.map(({ column, dir }) => {
            const col = columnOf(meta, column, 'orderBy ')
            return dir === 'desc' ? desc(col) : asc(col)
          }),
        )
      }
      if (opts.limit != null) query = query.limit(Number(opts.limit))
      if (opts.offset) query = query.offset(Number(opts.offset))
      const rows = await query
      return rows.map((r) => fromRow(r, meta))
    },

    async count(table, filter) {
      const { table: t, meta } = resolve(table)
      const where = whereOf(filter, meta)
      const query = db.select({ value: count() }).from(t)
      const [row] = await (where ? query.where(where) : query)
      return Number(row.value)
    },

    async upsert(table, row, { onConflict } = {}) {
      const { table: t, meta } = resolve(table)
      const values = toInput(row, meta)
      let query = db.insert(t).values(values)
      if (onConflict && onConflict.length) {
        const target = onConflict.map((name) => columnOf(meta, name, 'conflict '))
        // On conflict, update every NON-conflict column to the incoming value.
        const set = {}
        for (const [prop, value] of Object.entries(values)) {
          if (!onConflict.includes(meta.propToName[prop])) set[prop] = value
        }
        query = query.onConflictDoUpdate({ target, set: Object.keys(set).length ? set : values })
      }
      const [r] = await query.returning()
      return fromRow(r, meta)
    },

    async update(table, filter, patch) {
      const { table: t, meta } = resolve(table)
      const where = whereOf(filter, meta)
      const query = db.update(t).set(toInput(patch, meta))
      const rows = await (where ? query.where(where) : query).returning()
      return rows.map((r) => fromRow(r, meta))
    },

    async delete(table, filter) {
      const { table: t, meta } = resolve(table)
      const where = whereOf(filter, meta)
      const rows = await (where ? db.delete(t).where(where) : db.delete(t)).returning()
      return rows.length
    },
  }
}
