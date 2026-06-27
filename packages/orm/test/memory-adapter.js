// A minimal in-process adapter used to PIN the adapter contract in this package's
// tests. It is intentionally tiny and lives under test/ — the shippable memory
// adapter and `@gemstack/orm-drizzle` are #46. Any real adapter must honour the
// same six operations and the filter / list semantics from ../src/filter.js and
// ../src/list.js.

import { matchesFilter, applyListOpts } from '../src/index.js'

export function createMemoryAdapter() {
  const store = new Map() // table -> row[]
  const rows = (table) => {
    if (!store.has(table)) store.set(table, [])
    return store.get(table)
  }

  return {
    async insert(table, row) {
      rows(table).push({ ...row })
      return { ...row }
    },
    async find(table, filter, opts) {
      const matched = rows(table)
        .filter((r) => matchesFilter(r, filter))
        .map((r) => ({ ...r }))
      return applyListOpts(matched, opts)
    },
    async count(table, filter) {
      return rows(table).filter((r) => matchesFilter(r, filter)).length
    },
    async upsert(table, row, { onConflict } = {}) {
      const all = rows(table)
      if (onConflict && onConflict.length) {
        const existing = all.find((r) => onConflict.every((c) => r[c] === row[c]))
        if (existing) {
          Object.assign(existing, row)
          return { ...existing }
        }
      }
      all.push({ ...row })
      return { ...row }
    },
    async update(table, filter, patch) {
      const updated = []
      for (const r of rows(table)) {
        if (matchesFilter(r, filter)) {
          Object.assign(r, patch)
          updated.push({ ...r })
        }
      }
      return updated
    },
    async delete(table, filter) {
      const all = rows(table)
      const keep = all.filter((r) => !matchesFilter(r, filter))
      const removed = all.length - keep.length
      store.set(table, keep)
      return removed
    },
  }
}
