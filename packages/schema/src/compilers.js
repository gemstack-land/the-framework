// Per-ORM compilers. Each takes the same neutral IR (from defineSchema) and
// emits that ORM's schema artifact. Representative output for a spike, not a
// production-grade generator: enough to prove "define once, target any ORM".

const pascal = (s) => s.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

// Referential actions, mapped to each ORM's spelling.
const PRISMA_ON_DELETE = { cascade: 'Cascade', 'set null': 'SetNull', restrict: 'Restrict', 'no action': 'NoAction', 'set default': 'SetDefault' }

// ---------------------------------------------------------------- Prisma -----
function prismaType(c) {
  const base = { uuid: 'String', string: 'String', text: 'String', integer: 'Int', boolean: 'Boolean', timestamp: 'DateTime' }[c.type] || 'String'
  return base + (c.nullable ? '?' : '')
}
function prismaAttrs(c) {
  const a = []
  if (c.primary) a.push('@id')
  if (c.unique) a.push('@unique')
  if (c.type === 'uuid' && c.primary && c.default === undefined) a.push('@default(uuid())')
  if (c.default === 'now') a.push('@default(now())')
  else if (typeof c.default === 'boolean') a.push(`@default(${c.default})`)
  else if (c.default !== undefined) a.push(`@default(${JSON.stringify(c.default)})`)
  if (c.type === 'text') a.push('@db.Text')
  return a.join(' ')
}
// Prisma models the FK as a scalar column (kept below) PLUS a relation field, and
// needs an inverse field on the referenced model. `rel` is that table's slice of
// deriveRelations(); explicit @relation names make multiple/circular relations
// between the same two models unambiguous.
export function toPrisma(ir, rel = { forward: [], inverse: [] }) {
  const rows = ir.columns.map((c) => `  ${c.name} ${prismaType(c)} ${prismaAttrs(c)}`.trimEnd())
  const relRows = []
  for (const r of rel.forward) {
    const od = r.onDelete ? `, onDelete: ${PRISMA_ON_DELETE[r.onDelete] || 'NoAction'}` : ''
    // a composite FK carries column ARRAYS; a single-column FK its scalar fields
    const fields = (r.fkColumns ?? [r.fkColumn]).join(', ')
    const refs = (r.refColumns ?? [r.refColumn]).join(', ')
    relRows.push(`  ${r.fieldName} ${pascal(r.target)}${r.nullable ? '?' : ''} @relation("${r.name}", fields: [${fields}], references: [${refs}]${od})`)
  }
  for (const r of rel.inverse) {
    relRows.push(`  ${r.inverseFieldName ?? r.name} ${pascal(r.owner)}${r.toOne ? '?' : '[]'} @relation("${r.name}")`)
  }
  const body = relRows.length ? `${rows.join('\n')}\n\n${relRows.join('\n')}` : rows.join('\n')
  // Composite PK is a block-level @@id (single-column PKs use a field-level @id above).
  const blockAttrs = ir.primaryKey ? `\n\n  @@id([${ir.primaryKey.join(', ')}])` : ''
  return `model ${pascal(ir.table)} {\n${body}${blockAttrs}\n\n  @@map("${ir.table}")\n}`
}

// --------------------------------------------------------------- Drizzle -----
const DRIZZLE_FN = { uuid: 'uuid', string: 'varchar', text: 'text', integer: 'integer', boolean: 'boolean', timestamp: 'timestamp' }
function drizzleCol(c) {
  let s
  switch (c.type) {
    case 'string': s = `varchar('${c.name}', { length: 255 })`; break
    // mode: 'string' — universal-orm speaks ISO strings (its isoNow()), the same the
    // memory adapter stores, so the Drizzle column must accept/return strings too.
    // Without it Drizzle defaults to mode: 'date' and calls value.toISOString() on
    // write, throwing for the string values universal-orm passes.
    case 'timestamp': s = `timestamp('${c.name}', { mode: 'string' })`; break
    default: s = `${DRIZZLE_FN[c.type] || 'text'}('${c.name}')`
  }
  if (c.primary) s += '.primaryKey()'
  if (c.type === 'uuid' && c.primary && c.default === undefined) s += '.defaultRandom()'
  if (!c.nullable) s += '.notNull()'
  if (c.unique) s += '.unique()'
  if (c.default === 'now') s += '.defaultNow()'
  else if (typeof c.default === 'boolean') s += `.default(${c.default})`
  else if (c.default !== undefined) s += `.default(${JSON.stringify(c.default)})`
  // Column-level FK: Drizzle references the target table's exported column via a
  // lazy thunk (so declaration order / circular refs don't matter).
  if (c.references) {
    const od = c.onDelete ? `, { onDelete: '${c.onDelete}' }` : ''
    s += `.references(() => ${camel(c.references.table)}.${camel(c.references.column)}${od})`
  }
  return `  ${camel(c.name)}: ${s},`
}
export function toDrizzle(ir) {
  const fns = [...new Set(ir.columns.map((c) => DRIZZLE_FN[c.type] || 'text'))]
  // Composite PK / composite FK are Drizzle's table-extra config (a third pgTable
  // arg) and need the `primaryKey` / `foreignKey` helpers imported alongside the
  // column fns.
  if (ir.primaryKey) fns.push('primaryKey')
  if (ir.foreignKeys?.length) fns.push('foreignKey')
  const body = ir.columns.map(drizzleCol).join('\n')
  const extras = []
  if (ir.primaryKey) extras.push(`  pk: primaryKey({ columns: [${ir.primaryKey.map((n) => `table.${camel(n)}`).join(', ')}] }),`)
  // A composite FK references the target table's exported columns directly (not a
  // lazy thunk like the column-level single FK), so the target table must be
  // defined earlier in the module — the generator emits tables in dependency order.
  ;(ir.foreignKeys || []).forEach((fk, i) => {
    const cols = fk.columns.map((n) => `table.${camel(n)}`).join(', ')
    const fcols = fk.references.columns.map((n) => `${camel(fk.references.table)}.${camel(n)}`).join(', ')
    const od = fk.onDelete ? `.onDelete('${fk.onDelete}')` : ''
    extras.push(`  fk${i || ''}: foreignKey({ columns: [${cols}], foreignColumns: [${fcols}] })${od},`)
  })
  const extra = extras.length ? `, (table) => ({\n${extras.join('\n')}\n})` : ''
  return `import { pgTable, ${fns.join(', ')} } from 'drizzle-orm/pg-core'\n\nexport const ${camel(ir.table)} = pgTable('${ir.table}', {\n${body}\n}${extra})`
}

// ----------------------------------------------------------------- Rudder ----
// Targets the Rudder database engine (@rudderjs/database); WE own its migrations.
// Render one column as a Rudder schema-builder chain. `includePrimary` emits the
// inline `.primary()` for a `create` (default); an `alter` adds columns to an
// existing table and never re-declares the primary key, so generate.js passes
// `false`. Everything else (unique / nullable / default / FK + onDelete) renders
// identically, so both the create and alter paths share this one renderer.
export function rudderCol(c, { includePrimary = true } = {}) {
  let s = `t.${c.type}('${c.name}')`
  if (includePrimary && c.primary) s += '.primary()'
  if (c.unique) s += '.unique()'
  if (c.nullable) s += '.nullable()'
  if (c.default === 'now') s += '.useCurrent()'
  else if (c.default !== undefined) s += `.default(${JSON.stringify(c.default)})`
  // Column-level FK constraint (Laravel/Rudder style): WE own these migrations,
  // so the constraint is emitted inline on the column.
  if (c.references) {
    s += `.references('${c.references.column}').on('${c.references.table}')`
    if (c.onDelete) s += `.onDelete('${c.onDelete}')`
  }
  return `      ${s}`
}
export function toRudder(ir) {
  const cols = ir.columns.map(rudderCol)
  // Composite PK as a table-level constraint (single-column PKs use `.primary()` inline).
  if (ir.primaryKey) cols.push(`      t.primary([${ir.primaryKey.map((n) => `'${n}'`).join(', ')}])`)
  // Composite FK as a table-level constraint: t.foreign([...]).references([...]).on(table)
  // (single-column FKs are inline on the column above).
  for (const fk of ir.foreignKeys || []) {
    const c = fk.columns.map((n) => `'${n}'`).join(', ')
    const r = fk.references.columns.map((n) => `'${n}'`).join(', ')
    let s = `      t.foreign([${c}]).references([${r}]).on('${fk.references.table}')`
    if (fk.onDelete) s += `.onDelete('${fk.onDelete}')`
    cols.push(s)
  }
  const body = cols.join('\n')
  return `import { Migration, Schema } from '@rudderjs/database'\n\nexport default class extends Migration {\n  async up() {\n    await Schema.create('${ir.table}', (t) => {\n${body}\n    })\n  }\n}`
}

export const COMPILERS = { prisma: toPrisma, drizzle: toDrizzle, rudder: toRudder }
