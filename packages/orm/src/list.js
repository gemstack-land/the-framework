// List options for `find` — the narrow paging/ordering surface (#44, #86). A
// `find` call may take a second `opts` argument:
//
//   { limit, offset, orderBy }
//
//   limit   max rows to return        (a non-negative integer)
//   offset  rows to skip first        (a non-negative integer)
//   orderBy a single sort key or an array, evaluated in order:
//             'col'                    ascending by col
//             { column, dir }          dir is 'asc' (default) or 'desc'
//
// No opts (or an empty object) = every matching row, unordered: the original
// behaviour, so existing callers are unaffected. Anything richer (multi-column
// expressions, NULLS FIRST, cursor paging) stays out of scope — drop to the ORM.
//
// SQL-backed adapters (`@gemstack/orm-drizzle`) translate `orderBy`/limit/offset
// into ORDER BY / LIMIT / OFFSET; in-process adapters (memory, a future native one)
// share `applyListOpts` below so every adapter agrees on exactly what they mean.

// Normalize `orderBy` into an array of `{ column, dir }`. Throws on a missing
// column or an invalid direction so a typo is a clear error, not a silent no-op.
export function normalizeOrderBy(orderBy) {
  if (orderBy == null) return []
  const list = Array.isArray(orderBy) ? orderBy : [orderBy]
  return list.map((o) => {
    const column = typeof o === 'string' ? o : o?.column
    const dir = typeof o === 'object' && o?.dir != null ? o.dir : 'asc'
    if (!column || typeof column !== 'string') throw new Error('orderBy: each entry needs a column name')
    if (dir !== 'asc' && dir !== 'desc') throw new Error(`orderBy: invalid direction "${dir}" (use 'asc' or 'desc')`)
    return { column, dir }
  })
}

// Coerce a limit/offset to a non-negative integer, or undefined when absent.
// Rejects negatives and non-numbers so a bad `?page=` can't silently page weirdly.
export function asCount(value, what) {
  if (value == null) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what}: expected a non-negative integer, got ${JSON.stringify(value)}`)
  return n
}

// Apply orderBy then offset then limit to an in-memory array (the in-process
// adapters' shared implementation). Sorts a COPY; nulls sort last in either
// direction. Returns a new array.
export function applyListOpts(rows, opts = {}) {
  let out = rows
  const order = normalizeOrderBy(opts.orderBy)
  if (order.length) {
    out = [...out].sort((a, b) => {
      for (const { column, dir } of order) {
        const av = a[column]
        const bv = b[column]
        if (av === bv) continue
        if (av == null) return 1 // nulls last, regardless of direction
        if (bv == null) return -1
        const cmp = av < bv ? -1 : 1
        return dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }
  const offset = asCount(opts.offset, 'offset')
  if (offset) out = out.slice(offset)
  const limit = asCount(opts.limit, 'limit')
  if (limit != null) out = out.slice(0, limit)
  return out
}
