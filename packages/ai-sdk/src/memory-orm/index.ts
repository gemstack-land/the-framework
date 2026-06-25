/**
 * `@gemstack/ai-sdk/memory-orm` — ORM-backed {@link UserMemory} for #A4 Phase 4.
 *
 * Stores per-user facts in a `UserMemory` table via the registered
 * `@rudderjs/orm` adapter (Prisma today; Drizzle as well once the user's
 * tables are wired). Drop-in alongside Phase 1's in-process
 * `MemoryUserMemory`.
 *
 * Wire it from your AI config:
 *
 * ```ts
 * // config/ai.ts
 * import type { AiConfig } from '@gemstack/ai-sdk'
 * import { OrmUserMemory } from '@gemstack/ai-sdk/memory-orm'
 *
 * export default {
 *   default: 'anthropic/claude-sonnet-4-5',
 *   providers: { ... },
 *   memory: new OrmUserMemory(),
 * } satisfies AiConfig
 * ```
 *
 * The schema lives at `@gemstack/ai-sdk/memory-orm`'s {@link userMemoryPrismaSchema}
 * — copy it into your Prisma schema. The optional `embedding Bytes?`
 * column is shipped here in Phase 4 (intentionally nullable) so Phase 5's
 * `EmbeddingUserMemory` can populate it without forcing an additive
 * migration.
 */

import { Model } from '@rudderjs/orm'
import type {
  MemoryEntry,
  UserMemory,
} from '../types.js'

// ─── ORM Model ────────────────────────────────────────────

/**
 * The Model row backing {@link OrmUserMemory}. Exposed so apps that
 * want their own queries (admin views, audit dumps) can use the
 * familiar `UserMemoryRecord.where(...).get()` instead of routing
 * everything through the {@link UserMemory} interface.
 *
 * Tags persist as a JSON-encoded string in the `tags` column — both
 * Prisma's portable `String?` and Drizzle's `text` work without
 * needing native array columns. The {@link UserMemory.recall} path
 * filters tags in JavaScript for the same reason.
 *
 * The `embedding Bytes?` column is in the schema as of Phase 4
 * (nullable) so `@gemstack/ai-sdk/memory-embedding`'s `EmbeddingUserMemory`
 * (Phase 5) writes the Float32-packed vector here on `remember()` and
 * reads it for cosine recall. `OrmUserMemory` ignores it — the
 * column stays `null` for any row stored without the embedding
 * composer.
 */
export class UserMemoryRecord extends Model {
  static override table = 'userMemory'

  static override fillable = ['userId', 'fact', 'tags', 'score', 'embedding']

  declare id:        string
  declare userId:    string
  declare fact:      string
  /** JSON-encoded `string[]` or null. Use `getTags()` for the parsed shape. */
  declare tags:      string | null
  declare score:     number | null
  /**
   * Float32-packed vector serialized via
   * `@gemstack/ai-sdk/memory-embedding`'s `serializeVector` /
   * `deserializeVector`. `null` when the row was stored without the
   * embedding composer (Phase 4-only setups).
   */
  declare embedding: Uint8Array | null
  declare createdAt: Date
  declare updatedAt: Date | null

  /** Parsed tags array; empty when nothing was stored. */
  getTags(): string[] {
    if (this.tags == null || this.tags === '') return []
    try {
      const parsed = JSON.parse(this.tags) as unknown
      return Array.isArray(parsed) ? parsed.filter(t => typeof t === 'string') : []
    } catch {
      return []
    }
  }
}

// ─── UserMemory adapter ───────────────────────────────────

/**
 * `UserMemory` implementation that persists rows to the registered
 * ORM adapter. Designed for production use — the in-process
 * `MemoryUserMemory` is for tests and dev.
 *
 * Adapter coverage:
 * - Prisma — works out of the box; copy {@link userMemoryPrismaSchema}
 *   into your schema.
 * - Drizzle — works once you define a table matching the schema's
 *   columns and register it via `tables: { userMemory: <table> }` on
 *   the `drizzle()` config.
 *
 * Recall semantics: case-insensitive **token-OR-LIKE** matching against
 * the `fact` column. The query is tokenized on non-alphanumeric
 * boundaries (≥3-char tokens) and any row whose `fact` matches at
 * least one token via `LIKE %tok%` is returned. Mirrors Phase 1's
 * `MemoryUserMemory.recall()` behavior so the two backends are
 * swap-compatible. Tag scope is applied JS-side after fetch — pushing
 * tag-array filtering into the WHERE is adapter-specific and lands in a
 * follow-up.
 */
export class OrmUserMemory implements UserMemory {
  async remember(
    userId: string,
    fact:   string,
    opts?:  { tags?: string[]; score?: number },
  ): Promise<MemoryEntry> {
    const data: Record<string, unknown> = { userId, fact }
    if (opts?.tags  !== undefined) data['tags']  = JSON.stringify(opts.tags)
    if (opts?.score !== undefined) data['score'] = opts.score

    const created = await UserMemoryRecord.create(data) as unknown as UserMemoryRecord
    return rowToEntry(created)
  }

  async recall(
    userId: string,
    query:  string,
    opts?:  { limit?: number; tags?: string[] },
  ): Promise<MemoryEntry[]> {
    const tokens = tokenize(query)

    let q = UserMemoryRecord.where('userId', userId)
    if (tokens.size > 0) {
      const tokenList = [...tokens]
      q = q.whereGroup(g => {
        for (const tok of tokenList) g.orWhere('fact', 'LIKE', `%${tok}%`)
      })
    }

    const rows    = await q.orderBy('createdAt', 'ASC').get() as unknown as UserMemoryRecord[]
    const entries = rows.map(rowToEntry).filter(e => matchesTags(e, opts?.tags))
    return capLimit(entries, opts?.limit)
  }

  async forget(userId: string, factId: string): Promise<void> {
    const row = await UserMemoryRecord.where('id', factId).where('userId', userId).first() as unknown as UserMemoryRecord | null
    if (row) await row.delete()
  }

  async list(
    userId: string,
    opts?:  { tags?: string[]; limit?: number },
  ): Promise<MemoryEntry[]> {
    const rows    = await UserMemoryRecord.where('userId', userId).orderBy('createdAt', 'ASC').get() as unknown as UserMemoryRecord[]
    const entries = rows.map(rowToEntry).filter(e => matchesTags(e, opts?.tags))
    return capLimit(entries, opts?.limit)
  }

  async forgetAll(userId: string): Promise<void> {
    await UserMemoryRecord.where('userId', userId).deleteAll()
  }
}

// ─── Schema reference ─────────────────────────────────────

/**
 * Reference Prisma schema for `OrmUserMemory`. Copy into your
 * `prisma/schema/<file>.prisma` (or paste alongside an existing
 * model). The `embedding Bytes?` column is intentionally nullable so
 * Phase 5's `EmbeddingUserMemory` becomes additive — no schema
 * migration when you upgrade.
 *
 * SQLite stores `Bytes` as `BLOB`; Postgres stores it as `bytea`.
 * Both work for the dot-product implementation Phase 5 will use.
 */
export const userMemoryPrismaSchema = `model UserMemory {
  id        String   @id @default(cuid())
  userId    String
  fact      String
  /// JSON-encoded \`string[]\` of tags, or null
  tags      String?
  /// Confidence score in [0, 1] — extract sets this from the model's self-rating
  score     Float?
  /// Phase 5 — vector embedding for cosine recall (nullable so Phase 4 ignores it)
  embedding Bytes?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
`

// ─── Helpers ──────────────────────────────────────────────

function rowToEntry(row: UserMemoryRecord): MemoryEntry {
  const tags = row.getTags()
  const out: MemoryEntry = {
    id:        row.id,
    userId:    row.userId,
    fact:      row.fact,
    createdAt: row.createdAt,
  }
  if (tags.length > 0)        out.tags      = tags
  if (row.score != null)      out.score     = row.score
  if (row.updatedAt != null)  out.updatedAt = row.updatedAt
  return out
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>()
  for (const tok of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 3) out.add(tok)
  }
  return out
}

function matchesTags(entry: MemoryEntry, wanted: string[] | undefined): boolean {
  if (!wanted || wanted.length === 0) return true
  if (!entry.tags || entry.tags.length === 0) return false
  return wanted.every(t => entry.tags!.includes(t))
}

function capLimit<T>(items: T[], limit: number | undefined): T[] {
  return limit !== undefined && limit > 0 ? items.slice(0, limit) : items
}
