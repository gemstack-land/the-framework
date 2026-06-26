import type { AiMessage, ToolCall } from './types.js'
import type { CacheAdapter } from './cache-adapter.js'

/**
 * Discriminator for the kind of pause a snapshot represents. Determines
 * what payload `Agent.resumeAsTool` expects on continuation:
 *
 * - `'client_tool'` — resume must carry one tool-result per id in
 *   `pendingToolCallIds`. This is the original v1.4 behaviour and the
 *   default when the field is absent.
 * - `'approval'` — resume must carry `approvedToolCallIds` and/or
 *   `rejectedToolCallIds` covering the single id in `pendingToolCallIds`
 *   (the inner approval-gated tool call).
 */
export type SubAgentPauseKind = 'client_tool' | 'approval'

/**
 * Snapshot of a paused sub-agent run, persisted between an
 * {@link Agent.asTool} pause and an {@link Agent.resumeAsTool} resume.
 *
 * The shape is intentionally simple — `messages` is the full inner
 * conversation up to the pause point (system prompt + user input +
 * every interleaved tool result), so resume only needs to append the
 * incoming client-tool results (or inject approval decisions) and
 * re-enter the loop in `messages` mode.
 */
export interface SubAgentRunSnapshot {
  /** Inner-agent message history at suspend time. */
  messages:           AiMessage[]
  /**
   * Tool-call ids the sub-agent is waiting on.
   *
   * - `pauseKind === 'client_tool'` (default): one entry per client tool
   *   the inner loop surfaced; resume appends one result per id.
   * - `pauseKind === 'approval'`: a single entry for the approval-gated
   *   tool call; resume injects the id into `approvedToolCallIds`
   *   (or `rejectedToolCallIds`).
   */
  pendingToolCallIds: string[]
  /** Total steps the inner agent has executed across all suspends so far. */
  stepsSoFar:         number
  /** Total prompt+completion tokens accumulated across all suspends. */
  tokensSoFar:        number
  /**
   * Discriminator for the resume contract. Defaults to `'client_tool'`
   * when absent so older v1.4 snapshots remain readable on disk/redis
   * after the host upgrades to a version that knows about approval pauses.
   */
  pauseKind?:         SubAgentPauseKind
  /**
   * Approval pauses only. The full pending tool-call payload (name + args
   * + id) so a renderer can show "approve `delete_user(id=42)`?" without
   * round-tripping back to the inner agent. Mirrors the structure of
   * `AgentResponse.pendingApprovalToolCall`.
   */
  pendingApprovalToolCall?: { toolCall: ToolCall; isClientTool: boolean }
  /**
   * Opaque metadata the host can pass through. The framework treats
   * this as JSON and never reads it — useful for hosts that need to
   * rehydrate context (e.g. `{ resourceSlug, recordId, fieldScope, userId }`)
   * around the resume call.
   */
  meta?: unknown
}

/**
 * Pluggable persistence backend for paused sub-agent runs. The framework
 * ships two reference implementations:
 *
 * - {@link InMemorySubAgentRunStore} — a `Map`-backed store. Single-process
 *   only; fine for unit tests and small dev setups, lossy across worker
 *   processes and restarts.
 * - {@link CachedSubAgentRunStore} — adapter over any {@link CacheAdapter} you
 *   supply. Cross-process / cross-restart when that cache is backed by redis
 *   or any non-memory driver.
 *
 * Hosts may implement their own (Redis directly, Prisma, etc.) by
 * satisfying this interface.
 */
export interface SubAgentRunStore {
  /** Persist a snapshot under `subRunId`. Implementations MAY apply a TTL. */
  store(subRunId: string, snapshot: SubAgentRunSnapshot): Promise<void>
  /**
   * Atomic read + delete. Returns `null` if the id is unknown or the
   * snapshot has expired. Single-use semantics matter: a forged or
   * replayed `subRunId` must not return data twice.
   */
  consume(subRunId: string): Promise<SubAgentRunSnapshot | null>
  /**
   * Non-destructive read. Returns the snapshot without deleting it, or
   * `null` if the id is unknown or the snapshot has expired. Optional —
   * for hosts that need a **validate-then-resume** pre-flight: inspect a
   * paused snapshot's `meta` (ownership, resource-context, tool-result
   * coverage) before handing the id to {@link Agent.resumeAsTool} /
   * {@link Agent.resumeManyAsTool}, which own the single {@link consume}.
   * The resume paths never call this — so a `load` then resume reads the
   * snapshot once for validation and consumes it once on resume, with no
   * `consume` then re-`store` round-trip. Mirrors {@link AgentRunStore.load}.
   */
  load?(subRunId: string): Promise<SubAgentRunSnapshot | null>
}

// ─── In-memory ─────────────────────────────────────────────

/**
 * `Map`-backed implementation suitable for tests and single-process dev.
 * Loses state across restarts and worker processes — for any multi-worker
 * deployment, use {@link CachedSubAgentRunStore} or a custom backend.
 */
export class InMemorySubAgentRunStore implements SubAgentRunStore {
  private readonly snapshots = new Map<string, SubAgentRunSnapshot>()

  async store(subRunId: string, snapshot: SubAgentRunSnapshot): Promise<void> {
    this.snapshots.set(subRunId, snapshot)
  }

  async consume(subRunId: string): Promise<SubAgentRunSnapshot | null> {
    const snapshot = this.snapshots.get(subRunId)
    if (!snapshot) return null
    this.snapshots.delete(subRunId)
    return snapshot
  }

  async load(subRunId: string): Promise<SubAgentRunSnapshot | null> {
    return this.snapshots.get(subRunId) ?? null
  }

  /** Test helper — clears all snapshots without consuming. */
  clear(): void {
    this.snapshots.clear()
  }
}

// ─── Cache-backed store (bring your own CacheAdapter) ───────

export interface CachedSubAgentRunStoreOptions {
  /**
   * The cache to persist runs in. Supply any {@link CacheAdapter} (redis,
   * Memcached, a `Map`, a framework's cache). Required — `@gemstack/ai-sdk`
   * bundles no cache implementation.
   */
  cache:      CacheAdapter
  /** Key namespace prefix. Default `'gemstack:ai:sub-agent-run:'`. */
  keyPrefix?: string
  /** Time-to-live in seconds. Default 5 minutes. */
  ttlSeconds?: number
}

/**
 * Sub-agent run store backed by a caller-supplied {@link CacheAdapter}. The
 * framework depends on no cache package; you bring the cache and pass it as
 * `{ cache }`.
 *
 * Default TTL is 5 minutes — long enough for a browser to round-trip a
 * few client tool calls, short enough that abandoned runs garbage-collect
 * promptly and the storage bill stays bounded.
 */
export class CachedSubAgentRunStore implements SubAgentRunStore {
  private readonly cache:      CacheAdapter
  private readonly keyPrefix:  string
  private readonly ttlSeconds: number

  constructor(opts: CachedSubAgentRunStoreOptions) {
    if (!opts?.cache) {
      throw new Error('[ai-sdk] CachedSubAgentRunStore requires a cache adapter: new CachedSubAgentRunStore({ cache }).')
    }
    this.cache      = opts.cache
    this.keyPrefix  = opts.keyPrefix  ?? 'gemstack:ai:sub-agent-run:'
    this.ttlSeconds = opts.ttlSeconds ?? 5 * 60
  }

  async store(subRunId: string, snapshot: SubAgentRunSnapshot): Promise<void> {
    await this.cache.set(this.keyPrefix + subRunId, snapshot, this.ttlSeconds)
  }

  async consume(subRunId: string): Promise<SubAgentRunSnapshot | null> {
    const key = this.keyPrefix + subRunId
    const snapshot = await this.cache.get<SubAgentRunSnapshot>(key)
    if (!snapshot) return null
    await this.cache.forget(key)
    return snapshot
  }

  async load(subRunId: string): Promise<SubAgentRunSnapshot | null> {
    return this.cache.get<SubAgentRunSnapshot>(this.keyPrefix + subRunId)
  }
}
