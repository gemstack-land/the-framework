/**
 * `@gemstack/ai-sdk/memory-embedding` — embedding-backed {@link UserMemory}
 * for #A4 Phase 5.
 *
 * Composes Phase 4's {@link OrmUserMemory} with the embedding
 * provider registered on {@link AiRegistry}: `remember()` embeds the
 * fact and writes the Float32-packed vector into the row's
 * `embedding` column; `recall()` embeds the query and ranks by
 * cosine similarity. `forget()` / `forgetAll()` delegate to the
 * inner store — the embedding lives in the same row, so deleting
 * the row deletes the vector. GDPR right-to-be-forgotten cascades
 * automatically.
 *
 * v1 is **pure-JS cosine over the user's full set** — fine up to
 * a few thousand facts per user. For larger workloads, B7 lands a
 * pgvector-backed `EmbeddingUserMemory` that pushes the dot-product
 * into the database.
 *
 * @example
 * ```ts
 * import { OrmUserMemory } from '@gemstack/ai-sdk/memory-orm'
 * import { EmbeddingUserMemory } from '@gemstack/ai-sdk/memory-embedding'
 *
 * const memory = new EmbeddingUserMemory({
 *   inner: new OrmUserMemory(),
 *   model: 'openai/text-embedding-3-small',
 *   threshold: 0.5,    // cosine floor; matches below are dropped
 * })
 * ```
 *
 * **Pre-Phase-5 facts** (rows with `embedding === null`) fall back to
 * token-overlap matching against the `fact` column — same shape as
 * `MemoryUserMemory.recall()`. So upgrading from `OrmUserMemory` to
 * `EmbeddingUserMemory` doesn't lose recall on existing rows; new
 * `remember()` calls populate the embedding column going forward.
 */

import { AI } from '../facade.js'
import { OrmUserMemory, UserMemoryRecord } from '../memory-orm/index.js'
import type {
  MemoryEntry,
  UserMemory,
} from '../types.js'

export interface EmbeddingUserMemoryOptions {
  /**
   * The composed inner store. Must be {@link OrmUserMemory} for v1
   * — the composer reads/writes the `embedding Bytes?` column on
   * the same row. Other backends (Pinecone, Weaviate) implement
   * their own.
   */
  inner: OrmUserMemory
  /**
   * Embedding model id (`'<provider>/<model>'`). Used for both
   * fact embedding on `remember()` and query embedding on
   * `recall()`. Default: whatever `AI.embed()` picks (`AiRegistry`
   * default).
   */
  model?: string
  /**
   * Cosine-similarity floor in `[-1, 1]`. Matches below the
   * threshold are dropped before sorting. Default `0` — return
   * everything ranked. Tighten for higher precision; loosen for
   * higher recall.
   */
  threshold?: number
  /**
   * Optional fallback for rows whose `embedding` column is `null`
   * (rows persisted without the embedding composer wired in).
   *
   * - `'token-overlap'` (default) — score 0 if any ≥3-char token
   *   from the query appears in the row's `fact`. Lets you
   *   upgrade `OrmUserMemory` → `EmbeddingUserMemory` without
   *   losing recall on existing rows.
   * - `'skip'` — drop null-embedding rows entirely.
   */
  nullEmbeddingFallback?: 'token-overlap' | 'skip'
}

export class EmbeddingUserMemory implements UserMemory {
  private readonly inner:    OrmUserMemory
  private readonly model:    string | undefined
  private readonly threshold: number
  private readonly fallback: 'token-overlap' | 'skip'

  constructor(opts: EmbeddingUserMemoryOptions) {
    this.inner     = opts.inner
    if (opts.model !== undefined) this.model = opts.model
    this.threshold = opts.threshold ?? 0
    this.fallback  = opts.nullEmbeddingFallback ?? 'token-overlap'
  }

  async remember(
    userId: string,
    fact:   string,
    opts?:  { tags?: string[]; score?: number },
  ): Promise<MemoryEntry> {
    const entry = await this.inner.remember(userId, fact, opts)

    // Best-effort embed + persist. Failures are logged via the inner
    // store still having the entry; we don't break the caller.
    try {
      const vector = await this.embed(fact)
      await UserMemoryRecord.update(entry.id, {
        embedding: serializeVector(vector),
      })
    } catch {
      // Embedding failed (network, missing peer SDK). The row is
      // already in the store; recall will fall back to
      // token-overlap if the column stays null. No-op.
    }
    return entry
  }

  async recall(
    userId: string,
    query:  string,
    opts?:  { limit?: number; tags?: string[] },
  ): Promise<MemoryEntry[]> {
    let queryVector: number[] | null = null
    try {
      queryVector = await this.embed(query)
    } catch {
      // Embed failed — fall through to token-overlap on every row.
    }

    const rows  = await UserMemoryRecord.where('userId', userId).get() as unknown as UserMemoryRecord[]
    const wanted = opts?.tags

    const queryTokens = tokenize(query)

    const scored: Array<{ entry: MemoryEntry; score: number }> = []
    for (const row of rows) {
      const entry = rowToEntry(row)
      if (!matchesTags(entry, wanted)) continue

      let score: number
      if (queryVector !== null && row.embedding !== null && row.embedding !== undefined) {
        const factVector = deserializeVector(row.embedding)
        score = cosineSimilarity(queryVector, factVector)
      } else if (this.fallback === 'skip') {
        continue
      } else {
        // token-overlap fallback — score 0 (mid-range) if any
        // token matches, otherwise drop.
        if (factHasAnyToken(entry.fact, queryTokens)) {
          score = 0
        } else {
          continue
        }
      }

      if (score >= this.threshold) {
        scored.push({ entry, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const capped = capLimit(scored, opts?.limit)
    return capped.map(s => ({ ...s.entry, score: s.score }))
  }

  async forget(userId: string, factId: string): Promise<void> {
    // The embedding lives in the same row — deleting via the inner
    // store deletes the vector too. GDPR cascade is automatic.
    return this.inner.forget(userId, factId)
  }

  async list(
    userId: string,
    opts?:  { tags?: string[]; limit?: number },
  ): Promise<MemoryEntry[]> {
    return this.inner.list(userId, opts)
  }

  async forgetAll(userId: string): Promise<void> {
    if (!this.inner.forgetAll) return
    return this.inner.forgetAll(userId)
  }

  /**
   * Single-string embedding via the {@link AI} facade. Returns the
   * first (and only) embedding vector. Throws on provider/network
   * failure; callers route through try/catch and degrade.
   */
  private async embed(text: string): Promise<number[]> {
    const result = await AI.embed(text, this.model ? { model: this.model } : undefined)
    const vec = result.embeddings[0]
    if (!vec) throw new Error('[Rudder AI] embed() returned no vectors')
    return vec
  }
}

// ─── Vector + similarity helpers (exported for tests + B7) ─────

/**
 * Pack a `number[]` into a Float32 byte buffer. 4 bytes per dim;
 * a 1536-dim OpenAI embedding compresses to 6144 bytes.
 *
 * Uses `ArrayBuffer` + `Float32Array` so the output is a portable
 * `Uint8Array` (works in Node, browser, RN). Prisma's `Bytes`
 * column accepts both `Uint8Array` and `Buffer`.
 */
export function serializeVector(v: number[]): Uint8Array {
  const buf  = new ArrayBuffer(v.length * 4)
  const view = new Float32Array(buf)
  for (let i = 0; i < v.length; i++) view[i] = v[i]!
  return new Uint8Array(buf)
}

/**
 * Reverse of {@link serializeVector}. Reads the underlying byte
 * buffer as Float32 and returns a fresh `number[]` so callers can
 * mutate without affecting the source row.
 */
export function deserializeVector(bytes: Uint8Array): number[] {
  // The `bytes.buffer` may be a slice; honor byteOffset + byteLength
  // so we don't read into adjacent memory.
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  return Array.from(view)
}

/**
 * Cosine similarity in `[-1, 1]`. Returns `0` when either vector
 * has zero magnitude, or when lengths don't match (defensive — should
 * never happen if remember/recall use the same embedding model).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot  += ai * bi
    magA += ai * ai
    magB += bi * bi
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

// ─── Internal helpers ─────────────────────────────────────

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

function factHasAnyToken(fact: string, queryTokens: Set<string>): boolean {
  if (queryTokens.size === 0) return true
  const factTokens = tokenize(fact)
  for (const t of factTokens) if (queryTokens.has(t)) return true
  return false
}

function matchesTags(entry: MemoryEntry, wanted: string[] | undefined): boolean {
  if (!wanted || wanted.length === 0) return true
  if (!entry.tags || entry.tags.length === 0) return false
  return wanted.every(t => entry.tags!.includes(t))
}

function capLimit<T>(items: T[], limit: number | undefined): T[] {
  return limit !== undefined && limit > 0 ? items.slice(0, limit) : items
}
