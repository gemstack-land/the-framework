import type { AiMessage, ToolCall } from './types.js'
import type { CacheAdapter } from './cache-adapter.js'

/**
 * Discriminator for the kind of pause a standalone run is parked on.
 * Mirrors {@link SubAgentPauseKind} — the two run-store families share a
 * vocabulary so a host can persist sub-agent and top-level pauses the same way.
 *
 * - `'client_tool'` — the run surfaced one or more client tools; resume must
 *   carry one tool-result per id in `pendingToolCallIds`. The default when the
 *   field is absent (older snapshots stay readable after an upgrade).
 * - `'approval'` — the run stopped on an approval gate; resume must carry an
 *   approve/reject decision covering the single id in `pendingToolCallIds`.
 */
export type AgentPauseKind = 'client_tool' | 'approval'

/**
 * Snapshot of a paused **standalone** (top-level) agent run — the state a host
 * persists between an `agent.stream()` that parks on a client tool or approval
 * gate and the follow-up request that resumes it.
 *
 * This is the standalone sibling of {@link SubAgentRunSnapshot}: same idea, but
 * for a top-level `stream()` rather than an `Agent.asTool` sub-run. The shape is
 * intentionally replay-ready — `messages` is the full conversation up to the
 * pause point, so resume only appends the incoming client-tool results (or
 * injects the approval decision) and re-enters `stream()` in `messages` mode.
 */
export interface AgentRunState {
  /** Full conversation history at suspend time (system + user + every interleaved assistant/tool message). */
  messages:           AiMessage[]
  /**
   * Tool-call ids the run is waiting on.
   *
   * - `pauseKind === 'client_tool'` (default): one entry per client tool the
   *   loop surfaced; resume appends one result per id.
   * - `pauseKind === 'approval'`: a single entry for the approval-gated tool
   *   call; resume injects the id into the approve or reject set.
   */
  pendingToolCallIds: string[]
  /** Total steps the run has executed across all suspends so far. */
  stepsSoFar:         number
  /** Total prompt+completion tokens accumulated across all suspends. */
  tokensSoFar:        number
  /**
   * Discriminator for the resume contract. Defaults to `'client_tool'` when
   * absent so snapshots written before approval-pause support stay readable.
   */
  pauseKind?:         AgentPauseKind
  /**
   * Approval pauses only. The full pending tool-call payload (name + args + id)
   * so a renderer can show "approve `delete_user(id=42)`?" without re-running
   * the agent. Mirrors `AgentResponse.pendingApprovalToolCall`.
   */
  pendingApprovalToolCall?: { toolCall: ToolCall; isClientTool: boolean }
  /**
   * Opaque metadata the host can pass through. The framework treats this as
   * JSON and never reads it — useful for rehydrating request context
   * (e.g. `{ userId, threadId, agentSlug }`) around the resume call.
   */
  meta?: unknown
}

/**
 * Pluggable persistence backend for paused standalone agent runs. The framework
 * ships two reference implementations:
 *
 * - {@link InMemoryAgentRunStore} — a `Map`-backed store. Single-process only;
 *   fine for unit tests and small dev setups, lossy across worker processes and
 *   restarts.
 * - {@link CachedAgentRunStore} — adapter over any {@link CacheAdapter} you
 *   supply. Cross-process / cross-restart when that cache is backed by redis or
 *   any non-memory driver.
 *
 * Hosts may implement their own (Redis directly, Prisma, etc.) by satisfying
 * this interface.
 *
 * The split between {@link load} (non-destructive peek) and {@link consume}
 * (atomic single-use read+delete) matters: a host can `load()` to render a
 * "waiting for approval" view on a GET without burning the run, then `consume()`
 * on the resume POST so a forged or replayed `runId` cannot read data twice.
 */
export interface AgentRunStore {
  /** Persist a snapshot under `runId`. Implementations MAY apply a TTL. */
  store(runId: string, state: AgentRunState): Promise<void>
  /**
   * Non-destructive read. Returns `null` if the id is unknown or the snapshot
   * has expired. Leaves the snapshot in place — use for read-only peeks
   * (rendering a pending-run view); use {@link consume} when resuming.
   */
  load(runId: string): Promise<AgentRunState | null>
  /**
   * Atomic read + delete. Returns `null` if the id is unknown or the snapshot
   * has expired. Single-use semantics matter: a forged or replayed `runId` must
   * not return data twice.
   */
  consume(runId: string): Promise<AgentRunState | null>
}

/**
 * Generate a fresh, hard-to-guess run id. Uses `crypto.randomUUID()` where the
 * runtime exposes it (Node ≥ 16.7, every modern browser, Deno, Bun), falling
 * back to a timestamp + random suffix. Run ids are unguessable on purpose — a
 * `runId` is a capability handle to a parked conversation, so a predictable id
 * would let a third party `consume()` someone else's run.
 */
export function newAgentRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// ─── In-memory ─────────────────────────────────────────────

/**
 * `Map`-backed implementation suitable for tests and single-process dev.
 * Loses state across restarts and worker processes — for any multi-worker
 * deployment, use {@link CachedAgentRunStore} with a shared cache, or a custom
 * backend.
 */
export class InMemoryAgentRunStore implements AgentRunStore {
  private readonly states = new Map<string, AgentRunState>()

  async store(runId: string, state: AgentRunState): Promise<void> {
    this.states.set(runId, state)
  }

  async load(runId: string): Promise<AgentRunState | null> {
    return this.states.get(runId) ?? null
  }

  async consume(runId: string): Promise<AgentRunState | null> {
    const state = this.states.get(runId)
    if (!state) return null
    this.states.delete(runId)
    return state
  }

  /** Test helper — clears all snapshots without consuming. */
  clear(): void {
    this.states.clear()
  }
}

// ─── Cache-backed store (bring your own CacheAdapter) ───────

export interface CachedAgentRunStoreOptions {
  /**
   * The cache to persist runs in. Supply any {@link CacheAdapter} (redis,
   * Memcached, a `Map`, a framework's cache). Required — `@gemstack/ai-sdk`
   * bundles no cache implementation.
   */
  cache:       CacheAdapter
  /** Key namespace prefix. Default `'gemstack:ai:agent-run:'`. */
  keyPrefix?:  string
  /** Time-to-live in seconds. Default 5 minutes. */
  ttlSeconds?: number
}

/**
 * Standalone agent run store backed by a caller-supplied {@link CacheAdapter}.
 * The framework depends on no cache package; you bring the cache and pass it as
 * `{ cache }`.
 *
 * Default TTL is 5 minutes — long enough for a browser to round-trip a few
 * client tool calls or an approval decision, short enough that abandoned runs
 * garbage-collect promptly and the storage bill stays bounded.
 */
export class CachedAgentRunStore implements AgentRunStore {
  private readonly cache:      CacheAdapter
  private readonly keyPrefix:  string
  private readonly ttlSeconds: number

  constructor(opts: CachedAgentRunStoreOptions) {
    if (!opts?.cache) {
      throw new Error('[ai-sdk] CachedAgentRunStore requires a cache adapter: new CachedAgentRunStore({ cache }).')
    }
    this.cache      = opts.cache
    this.keyPrefix  = opts.keyPrefix  ?? 'gemstack:ai:agent-run:'
    this.ttlSeconds = opts.ttlSeconds ?? 5 * 60
  }

  async store(runId: string, state: AgentRunState): Promise<void> {
    await this.cache.set(this.keyPrefix + runId, state, this.ttlSeconds)
  }

  async load(runId: string): Promise<AgentRunState | null> {
    return (await this.cache.get<AgentRunState>(this.keyPrefix + runId)) ?? null
  }

  async consume(runId: string): Promise<AgentRunState | null> {
    const key = this.keyPrefix + runId
    const state = await this.cache.get<AgentRunState>(key)
    if (!state) return null
    await this.cache.forget(key)
    return state
  }
}
