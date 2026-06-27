// Neutral, DECLARATIVE schema IR + a tiny builder DSL.
//
// An extension describes its tables ONCE; the result is plain data (no ORM
// imported) that flows through Vike's cumulative config as a contribution.
//
//   defineSchema('users', t => ...)   -> create a new table
//   extendSchema('users', t => ...)   -> add columns to an existing table
//                                        (possibly one ANOTHER extension created)
//
// Migrations are NOT authored here; they are derived from this schema (see
// merge.js). Schema is the source of truth.

function buildColumns(build) {
  const columns = []
  const meta = {} // table-level: { primaryKey?: string[], foreignKeys?: ForeignKey[] }
  const col = (name, type) => {
    const c = { name, type, nullable: false, unique: false, primary: false, default: undefined }
    columns.push(c)
    const api = {
      primary() { c.primary = true; return api },
      unique() { c.unique = true; return api },
      nullable() { c.nullable = true; return api },
      default(v) { c.default = v; return api },
      // Semantic UI hint: what the column MEANS (email, file, enum, longtext, json,
      // date, ...), separate from its storage `type` and orthogonal to it. `.as()`
      // is a fact about the data, NOT a rendering instruction: an email column is
      // still a string column, so this does NOT change DDL/migrations (the compilers
      // only read storage `type`/flags and ignore `semantic`). It rides on the column
      // as plain data so every consumer derives its OWN rendering from one shared
      // declaration — vike-admin's field-widget registry today, a future read-only or
      // email renderer tomorrow. The vocabulary is OPEN (any non-empty string): a
      // consumer that doesn't recognize a semantic type falls back to the storage
      // `type`, and an extension can introduce a new one alongside the widget that
      // renders it (e.g. vike-storage adds `file`). `opts` carries per-semantic data,
      // e.g. enum's allowed `{ values }`.
      as(semantic, opts = {}) {
        if (typeof semantic !== 'string' || semantic === '') {
          throw new Error('.as(semantic) expects a non-empty string semantic type')
        }
        c.semantic = semantic
        if (Object.keys(opts).length) c.semanticOptions = { ...opts }
        return api
      },
      // Foreign key. `target` is 'table' (defaults to its `id` column) or
      // 'table.column'. The reference is plain data: merge.js validates the
      // target exists (even when another extension owns the table), and each ORM
      // compiler renders it natively (Prisma relations / Drizzle .references /
      // a Rudder FK constraint). `onDelete` is the referential action.
      //
      // Relation-field naming (Prisma navigation fields): by default the forward
      // field strips a trailing `_id` (`user_id` -> `user`, else `<col>_ref`) and
      // the inverse field reuses the unique relation name. `as` overrides the
      // forward field name, `inverseAs` the inverse one — useful for readability
      // and ESSENTIAL for self-references (e.g. `invited_by` -> `inviter` /
      // `invitees`), where the auto names are awkward.
      references(target, opts = {}) {
        const [table, column = 'id'] = String(target).split('.')
        c.references = { table, column }
        if (opts.onDelete) c.onDelete = opts.onDelete
        if (opts.as) c.relationField = opts.as
        if (opts.inverseAs) c.inverseField = opts.inverseAs
        return api
      },
      onDelete(action) { c.onDelete = action; return api },
    }
    return api
  }
  const t = {
    uuid: (n) => col(n, 'uuid'),
    string: (n) => col(n, 'string'),
    text: (n) => col(n, 'text'),
    integer: (n) => col(n, 'integer'),
    boolean: (n) => col(n, 'boolean'),
    timestamp: (n) => col(n, 'timestamp'),
    // sugar: created_at + updated_at, both defaulting to now. `updatedAt: false`
    // omits `updated_at` for an APPEND-ONLY / immutable row (an event log, a charge
    // record) where a mutable-row timestamp would be a lie — the row is recorded
    // once and never updated.
    timestamps(opts = {}) {
      col('created_at', 'timestamp').default('now')
      if (opts.updatedAt !== false) col('updated_at', 'timestamp').default('now')
    },
    // TABLE-LEVEL composite primary key over >=2 columns (e.g. a join table keyed
    // on both its FKs). Single-column PKs stay column-level (`t.uuid('id').primary()`);
    // this is the multi-column case Prisma/Drizzle/Rudder each spell differently
    // (@@id / primaryKey() / t.primary([...])). The named columns must exist.
    primaryKey(...names) {
      meta.primaryKey = names
    },
    // TABLE-LEVEL composite (multi-column) FOREIGN KEY. Single-column FKs stay
    // column-level (`t.uuid('user_id').references('users.id')`); a FK over >=2
    // columns is table-level because it references a multi-column key AS A UNIT.
    // The local + target column lists must be the same length, and the local
    // columns must exist (target existence is a cross-extension check in merge.js,
    // exactly like single-column `.references()`). Each ORM spells it differently
    // (Prisma @relation fields:[a,b] / Drizzle foreignKey({columns,foreignColumns})
    // / Rudder t.foreign([...]).references([...]).on(...)). `as`/`inverseAs` name the
    // Prisma navigation fields (recommended here — the `_id`-strip heuristic that
    // single-column FKs use doesn't apply to a multi-column key).
    //
    //   t.foreignKey(['org_id', 'tenant_id'], 'organizations', ['id', 'tenant_id'],
    //                { onDelete: 'cascade', as: 'organization', inverseAs: 'memberships' })
    foreignKey(columns, table, references, opts = {}) {
      const cols = Array.isArray(columns) ? columns : [columns]
      const refs = Array.isArray(references) ? references : [references]
      const fk = { columns: cols, references: { table, columns: refs } }
      if (opts.onDelete) fk.onDelete = opts.onDelete
      if (opts.as) fk.relationField = opts.as
      if (opts.inverseAs) fk.inverseField = opts.inverseAs
      ;(meta.foreignKeys ||= []).push(fk)
    },
  }
  build(t)
  if (meta.primaryKey) {
    for (const name of meta.primaryKey) {
      if (!columns.some((c) => c.name === name)) {
        throw new Error(`primaryKey references unknown column "${name}"`)
      }
    }
  }
  for (const fk of meta.foreignKeys || []) {
    for (const name of fk.columns) {
      if (!columns.some((c) => c.name === name)) {
        throw new Error(`foreignKey references unknown column "${name}"`)
      }
    }
    if (fk.columns.length !== fk.references.columns.length) {
      throw new Error(
        `foreignKey column count mismatch: [${fk.columns.join(', ')}] -> ${fk.references.table}.[${fk.references.columns.join(', ')}]`,
      )
    }
  }
  return { columns, meta }
}

export function defineSchema(table, build) {
  const { columns, meta } = buildColumns(build)
  return {
    table,
    mode: 'create',
    columns,
    ...(meta.primaryKey ? { primaryKey: meta.primaryKey } : {}),
    ...(meta.foreignKeys ? { foreignKeys: meta.foreignKeys } : {}),
  }
}

export function extendSchema(table, build) {
  const { columns } = buildColumns(build)
  return { table, mode: 'extend', columns }
}

// Many-to-many sugar: derive the join table that links two existing tables.
// m2m has no first-class column model — it IS a join table with two FKs and a
// composite PK over them. This helper emits exactly that as a normal `create`
// fragment, so it flows through merge/relations/codegen like any other table
// (deriveRelations sees two non-unique FKs -> two one-to-many legs = the m2m).
//
//   defineJoinTable('users', 'roles')
//     -> table `roles_users` { user_id -> users.id, role_id -> roles.id, PK(both) }
//
// Options: `table` overrides the derived name; `columns` overrides a derived FK
// column name ({ users: 'member_id' }); `type` sets the FK column type (default
// 'uuid', matching the repo's `t.uuid('id').primary()` convention); `onDelete`
// sets the referential action on both FKs (default 'cascade' — drop the link row
// when either side is deleted, the usual join-table semantics).
export function defineJoinTable(tableA, tableB, opts = {}) {
  const name = opts.table || [tableA, tableB].slice().sort().join('_')
  const type = opts.type || 'uuid'
  const onDelete = opts.onDelete || 'cascade'
  const fk = (t) => opts.columns?.[t] || `${singularize(t)}_id`
  const [colA, colB] = [fk(tableA), fk(tableB)]
  // The two FK columns must be distinct, else we'd emit a table with a duplicated column
  // and a `[col, col]` primary key — an invalid artifact, silently. Throw with an accurate
  // remedy for each cause.
  if (colA === colB) {
    // A self-referential m2m (`defineJoinTable('users','users')` — friendships/followers)
    // can't be fixed by `columns` (keyed by table name -> same key both sides), so point at
    // defineSchema. Two DIFFERENT tables that singularize identically CAN use `columns`.
    const remedy =
      tableA === tableB
        ? `self-referential many-to-many isn't supported here — define the join table directly with ` +
          `defineSchema('${name}', t => { ... }) and name its two foreign-key columns yourself.`
        : `pass distinct names via { columns: { '${tableA}': 'a_id', '${tableB}': 'b_id' } }.`
    throw new Error(`defineJoinTable('${tableA}', '${tableB}'): both foreign keys resolve to the column "${colA}". ${remedy}`)
  }
  return defineSchema(name, (t) => {
    t[type](colA).references(`${tableA}.id`, { onDelete })
    t[type](colB).references(`${tableB}.id`, { onDelete })
    t.primaryKey(colA, colB)
  })
}

// Minimal English singularization for FK naming (users -> user, companies ->
// company). Good enough for the convention here; pass `columns` to override when
// a table name pluralizes irregularly.
function singularize(word) {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}
