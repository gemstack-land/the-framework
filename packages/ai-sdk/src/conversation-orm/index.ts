/**
 * `@gemstack/ai-sdk/conversation-orm` - ORM-backed {@link ConversationStore}.
 *
 * Production-grade replacement for `MemoryConversationStore` (which is
 * single-process, in-memory, and loses every thread on restart). Persists
 * conversation threads and their messages via the registered `@rudderjs/orm`
 * adapter - works across web processes, queue workers, and horizontally
 * scaled deployments. Mirrors the `@gemstack/ai-sdk/memory-orm` /
 * `@gemstack/ai-sdk/budget-orm` pattern.
 *
 * Wire it as the conversation store:
 *
 * ```ts
 * import { setConversationStore } from '@gemstack/ai-sdk'
 * import { OrmConversationStore } from '@gemstack/ai-sdk/conversation-orm'
 *
 * setConversationStore(new OrmConversationStore())
 * ```
 *
 * The schema lives at {@link conversationOrmPrismaSchema} - copy it into your
 * Prisma schema (or a new `prisma/schema/<file>.prisma` if you use the
 * multi-file setup). On the native engine, add an equivalent migration; on
 * Drizzle, define matching tables and register them via `tables: { ... }`.
 *
 * # Adapter coverage
 *
 * - Prisma - works out of the box; copy {@link conversationOrmPrismaSchema}.
 * - Native - add a migration with the same columns.
 * - Drizzle - define the two tables and register them on the `drizzle()`
 *   config.
 *
 * # Ordering & concurrency
 *
 * Messages carry a monotonic per-thread `position` so `load()` returns them
 * in append order regardless of timestamp granularity. `append()` reads the
 * current max position and assigns the next slots; like
 * `OrmBudgetStorage.checkAndDebit`, the read-then-write is not isolated, so
 * two concurrent appends to the SAME thread could collide on a position.
 * Conversation threads are single-writer in practice (one user, one turn at
 * a time), so this is a non-issue for typical apps. File an issue if you hit
 * it; strict ordering needs a serializable transaction or a DB sequence.
 */

import { Model } from '@rudderjs/orm'
import { sanitizeConversation } from '../sanitize-conversation.js'
import type {
  AiMessage,
  ConversationStore,
  ConversationStoreListEntry,
  ConversationStoreMeta,
  ToolCall,
} from '../types.js'

// ─── ORM Models ───────────────────────────────────────────

/**
 * The thread row backing {@link OrmConversationStore}. Exposed so apps that
 * want their own queries (admin views, analytics) can use
 * `AiConversationRecord.where(...).get()` directly.
 *
 * `userId` / `agent` mirror {@link ConversationStoreMeta} - `userId` scopes
 * `list()`, `agent` carries the thread-segregation key the auto-persist
 * machinery uses to keep one user's threads per agent class apart.
 */
export class AiConversationRecord extends Model {
  static override table    = 'aiConversation'
  static override fillable = ['title', 'userId', 'agent', 'updatedAt']

  declare id:        string
  declare title:     string
  declare userId:    string | null
  declare agent:     string | null
  declare createdAt: Date
  declare updatedAt: Date | null
}

/**
 * One message row in a thread. `content` and `toolCalls` are JSON-encoded
 * strings (so a `string` content and a `ContentPart[]` content both
 * round-trip through a portable `text` column); `position` orders them.
 */
export class AiConversationMessageRecord extends Model {
  static override table    = 'aiConversationMessage'
  static override fillable = ['conversationId', 'position', 'role', 'content', 'toolCallId', 'toolCalls']

  declare id:             string
  declare conversationId: string
  declare position:       number
  declare role:           string
  /** JSON-encoded `string | ContentPart[]`. */
  declare content:        string
  declare toolCallId:     string | null
  /** JSON-encoded `ToolCall[]` or null. */
  declare toolCalls:      string | null
  declare createdAt:      Date
}

// ─── ConversationStore adapter ────────────────────────────

/**
 * {@link ConversationStore} implementation that persists rows to the
 * registered ORM adapter. Designed for production use - the in-process
 * `MemoryConversationStore` is for tests and dev.
 */
export class OrmConversationStore implements ConversationStore {
  async create(title?: string, meta?: ConversationStoreMeta): Promise<string> {
    const data: Record<string, unknown> = { title: title ?? 'New conversation' }
    if (meta?.userId !== undefined) data['userId'] = meta.userId
    if (meta?.agent  !== undefined) data['agent']  = meta.agent

    const created = await AiConversationRecord.create(data) as unknown as AiConversationRecord
    return created.id
  }

  async load(conversationId: string): Promise<AiMessage[]> {
    await this.requireThread(conversationId)
    const rows = await AiConversationMessageRecord
      .where('conversationId', conversationId)
      .orderBy('position', 'ASC')
      .get() as unknown as AiConversationMessageRecord[]
    // A thread persisted mid-turn (crash between the assistant row and its
    // tool-result rows) would otherwise replay into a provider 400. Drop the
    // incomplete turns at the load boundary so the history is replay-safe.
    return sanitizeConversation(rows.map(rowToMessage))
  }

  async append(conversationId: string, messages: AiMessage[]): Promise<void> {
    await this.requireThread(conversationId)
    if (messages.length === 0) return

    let position = await this.nextPosition(conversationId)
    for (const message of messages) {
      await AiConversationMessageRecord.create(messageToRow(conversationId, position, message))
      position++
    }

    await AiConversationRecord.where('id', conversationId).updateAll({ updatedAt: new Date() })
  }

  async setTitle(conversationId: string, title: string): Promise<void> {
    const updated = await AiConversationRecord
      .where('id', conversationId)
      .updateAll({ title, updatedAt: new Date() })
    if (!updated) throw notFound(conversationId)
  }

  async list(userId?: string): Promise<ConversationStoreListEntry[]> {
    let q = AiConversationRecord.query()
    if (userId != null) q = q.where('userId', userId)
    const rows = await q.orderBy('updatedAt', 'DESC').get() as unknown as AiConversationRecord[]
    return rows.map(rowToListEntry)
  }

  async delete(conversationId: string): Promise<void> {
    await AiConversationMessageRecord.where('conversationId', conversationId).deleteAll()
    await AiConversationRecord.where('id', conversationId).deleteAll()
  }

  /** Throw the same not-found error shape as `MemoryConversationStore`. */
  private async requireThread(conversationId: string): Promise<void> {
    const thread = await AiConversationRecord.where('id', conversationId).first()
    if (!thread) throw notFound(conversationId)
  }

  /** Next monotonic position for the thread (0 when empty). */
  private async nextPosition(conversationId: string): Promise<number> {
    const last = await AiConversationMessageRecord
      .where('conversationId', conversationId)
      .orderBy('position', 'DESC')
      .first() as unknown as AiConversationMessageRecord | null
    return last ? last.position + 1 : 0
  }
}

/** Convenience factory mirroring `ormBudgetStorage()` / `OrmUserMemory`. */
export function ormConversationStore(): OrmConversationStore {
  return new OrmConversationStore()
}

// ─── Schema reference ─────────────────────────────────────

/**
 * Reference Prisma schema for `OrmConversationStore`. Copy into your
 * `prisma/schema/<file>.prisma`. SQLite stores the `text` content as TEXT;
 * Postgres as `text`. The `@@index` keeps `list()` (by user) and `load()`
 * (by thread, ordered) cheap.
 */
export const conversationOrmPrismaSchema = `model AiConversation {
  id        String   @id @default(cuid())
  title     String
  userId    String?
  /// Thread-segregation key - the agent class name by default
  agent     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

model AiConversationMessage {
  id             String   @id @default(cuid())
  conversationId String
  /// Monotonic per-thread ordering
  position       Int
  role           String
  /// JSON-encoded \`string | ContentPart[]\`
  content        String
  toolCallId     String?
  /// JSON-encoded \`ToolCall[]\` or null
  toolCalls      String?
  createdAt      DateTime @default(now())

  @@index([conversationId, position])
}
`

// ─── Helpers ──────────────────────────────────────────────

function notFound(conversationId: string): Error {
  return new Error(`[ai-sdk] Conversation "${conversationId}" not found.`)
}

function messageToRow(conversationId: string, position: number, m: AiMessage): Record<string, unknown> {
  return {
    conversationId,
    position,
    role:       m.role,
    content:    JSON.stringify(m.content),
    toolCallId: m.toolCallId ?? null,
    toolCalls:  m.toolCalls ? JSON.stringify(m.toolCalls) : null,
  }
}

function rowToMessage(row: AiConversationMessageRecord): AiMessage {
  const out: AiMessage = {
    role:    row.role as AiMessage['role'],
    content: JSON.parse(row.content) as AiMessage['content'],
  }
  if (row.toolCallId != null) out.toolCallId = row.toolCallId
  if (row.toolCalls  != null) out.toolCalls  = JSON.parse(row.toolCalls) as ToolCall[]
  return out
}

function rowToListEntry(row: AiConversationRecord): ConversationStoreListEntry {
  const out: ConversationStoreListEntry = {
    id:        row.id,
    title:     row.title,
    createdAt: row.createdAt,
  }
  if (row.updatedAt != null) out.updatedAt = row.updatedAt
  if (row.agent     != null) out.agent     = row.agent
  return out
}
