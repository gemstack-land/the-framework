// A filter is a plain object of column -> condition. Two condition forms only —
// the narrow surface (#44):
//
//   { col: value }          equality       (col === value)
//   { col: { in: [...] } }  membership     (value of col is one of the list)
//
// An empty filter `{}` matches every row. Anything richer (ranges, OR, LIKE,
// joins) is deliberately out of scope: drop to the underlying ORM for those, the
// same escape hatch as DB-specific column types.
//
// Adapters that filter IN PROCESS (the memory adapter, a future native one) share
// this matcher so every adapter agrees on exactly what a filter means. SQL-backed
// adapters (`@gemstack/orm-drizzle`) translate the same shape into a WHERE clause
// instead, but must honour the identical semantics.
// True when a filter condition is the membership form `{ in: [...] }` rather than a plain
// equality value. The one predicate that tells the two condition forms apart, shared so the
// in-process matcher here and the SQL adapters (drizzle/rudder) can't drift on what an `in`
// condition is.
export function isInCondition(cond) {
  return cond !== null && typeof cond === 'object' && Array.isArray(cond.in)
}

export function matchesFilter(row, filter = {}) {
  for (const [col, cond] of Object.entries(filter)) {
    if (isInCondition(cond)) {
      if (!cond.in.includes(row[col])) return false
    } else if (row[col] !== cond) {
      return false
    }
  }
  return true
}
