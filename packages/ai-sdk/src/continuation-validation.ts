import type { AiMessage, ContinuationValidator, ToolCall, ValidateContinuationOptions } from './types.js'

export type { ContinuationValidator, ValidateContinuationOptions } from './types.js'

/**
 * Continuation validation — defends the auto-persist / continuation path
 * against a client that resubmits a forged conversation.
 *
 * `runWithPersistence` (and the explicit `forUser`/`continue` form) trusts
 * the caller's incoming history. A continuation request after a client-tool
 * or approval round-trip carries the prior messages back from the browser,
 * which means a malicious caller can:
 *
 *  1. **Rewrite history / continue someone else's thread (IDOR)** — send
 *     messages that don't match what the server persisted for this thread.
 *  2. **Forge a tool result** — append a `tool` message answering a tool
 *     call that the server never issued (smuggling attacker-chosen data in
 *     as if a tool produced it).
 *  3. **Forge an approval** — claim `approvedToolCallIds` for a tool call
 *     that isn't actually pending approval.
 *
 * {@link validateContinuation} runs all three checks against the trusted
 * `persisted` history and returns a verdict. {@link assertValidContinuation}
 * throws {@link ContinuationValidationError} on failure, and
 * {@link defaultContinuationValidator} adapts it to the
 * {@link ContinuationValidator} hook shape consumed by `AgentPromptOptions`.
 */

export type ContinuationRejectionCode =
  | 'not-a-prefix'
  | 'forged-tool-result'
  | 'forged-approval'

export interface ContinuationValidationResult {
  /** `true` when the incoming continuation is a legitimate extension of `persisted`. */
  ok: boolean
  /** Machine-readable reason, present only when `ok` is `false`. */
  code?: ContinuationRejectionCode
  /** Human-readable explanation, present only when `ok` is `false`. */
  reason?: string
  /**
   * Index of the offending message — into `incoming` for `not-a-prefix` and
   * `forged-tool-result`. Absent for `forged-approval` (the offending id is
   * named in `reason` instead).
   */
  index?: number
}

/**
 * Recursively sort object keys (and drop `undefined`) so two semantically
 * equal values compare equal regardless of key insertion order. Without this,
 * a tool-call `arguments` object reordered across a serialization boundary
 * (e.g. loaded back from a Postgres `jsonb` column, which does not preserve
 * key order, or rebuilt by the client) would be read as a forgery.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key]
    if (v === undefined) continue
    out[key] = canonicalize(v)
  }
  return out
}

/** Order-insensitive JSON of a value. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** Order-insensitive string form of message content. */
function contentString(content: AiMessage['content']): string {
  return typeof content === 'string' ? content : canonicalJson(content)
}

/**
 * Compare two messages field by field, order-insensitively. Returns a
 * human-readable reason naming the first diverging field, or `null` when the
 * messages are equivalent. Used by the prefix check so a rejection points at
 * exactly what diverged.
 */
function messageDiffReason(a: AiMessage, b: AiMessage): string | null {
  if (a.role !== b.role) return `role: persisted "${a.role}" vs incoming "${b.role}"`
  if (contentString(a.content) !== contentString(b.content)) return 'content differs'
  if ((a.toolCallId ?? null) !== (b.toolCallId ?? null)) {
    return `toolCallId: persisted "${a.toolCallId ?? 'null'}" vs incoming "${b.toolCallId ?? 'null'}"`
  }
  const aCalls = a.toolCalls ?? []
  const bCalls = b.toolCalls ?? []
  if (aCalls.length !== bCalls.length) return `toolCalls length: persisted ${aCalls.length} vs incoming ${bCalls.length}`
  for (let i = 0; i < aCalls.length; i++) {
    const ac = aCalls[i]!
    const bc = bCalls[i]!
    if (ac.id !== bc.id)     return `toolCalls[${i}].id: persisted "${ac.id}" vs incoming "${bc.id}"`
    if (ac.name !== bc.name) return `toolCalls[${i}].name: persisted "${ac.name}" vs incoming "${bc.name}"`
    if (canonicalJson(ac.arguments) !== canonicalJson(bc.arguments)) return `toolCalls[${i}].arguments differ (${ac.name})`
  }
  return null
}

/** Collect every tool-call id the model requested across the given messages. */
function requestedToolCallIds(messages: readonly AiMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const c of m.toolCalls as ToolCall[]) ids.add(c.id)
    }
  }
  return ids
}

/**
 * Validate that an `incoming` continuation is a legitimate extension of the
 * server-persisted `persisted` history. Pure and synchronous — safe to call
 * from any runtime. Returns a verdict; never throws.
 *
 * Checks, in order:
 *
 * - **Prefix equality.** Every message the two share by position must match
 *   (role, content, `toolCallId`, and any assistant `toolCalls`). Comparison
 *   is order-insensitive for nested objects, so a tool-call `arguments` map
 *   reordered across a serialization boundary still matches. A genuine
 *   mismatch means the caller rewrote history or is replaying a different
 *   thread (IDOR) → `not-a-prefix`.
 * - **Tool-result forgery.** Every `tool` message in `incoming` must answer
 *   a tool call actually requested by some assistant message (in either
 *   `persisted` or `incoming`). A `tool` message with no matching request is
 *   smuggled data → `forged-tool-result`.
 * - **Approval forgery.** Every id in `opts.approvedToolCallIds` /
 *   `opts.rejectedToolCallIds` must reference a real requested tool call →
 *   `forged-approval`.
 */
export function validateContinuation(
  persisted: readonly AiMessage[],
  incoming: readonly AiMessage[],
  opts: ValidateContinuationOptions = {},
): ContinuationValidationResult {
  // 1. Prefix equality over the shared region. Comparison is order-insensitive
  //    for nested objects (tool-call arguments, structured content) so a
  //    legitimately reordered argument map is not mistaken for a forgery.
  const overlap = Math.min(persisted.length, incoming.length)
  for (let i = 0; i < overlap; i++) {
    const diff = messageDiffReason(persisted[i]!, incoming[i]!)
    if (diff) {
      return {
        ok: false,
        code: 'not-a-prefix',
        index: i,
        reason: `incoming message at index ${i} diverges from the persisted history (${diff})`,
      }
    }
  }

  // 2. Tool-result forgery — a tool message must answer a requested call.
  const requested = requestedToolCallIds([...persisted, ...incoming])
  for (let i = 0; i < incoming.length; i++) {
    const m = incoming[i]!
    if (m.role === 'tool' && (!m.toolCallId || !requested.has(m.toolCallId))) {
      return {
        ok: false,
        code: 'forged-tool-result',
        index: i,
        reason: `tool message at index ${i} references tool call "${m.toolCallId ?? '<missing>'}" that was never requested`,
      }
    }
  }

  // 3. Approval forgery — approved/rejected ids must be real requested calls.
  for (const id of [...(opts.approvedToolCallIds ?? []), ...(opts.rejectedToolCallIds ?? [])]) {
    if (!requested.has(id)) {
      return {
        ok: false,
        code: 'forged-approval',
        reason: `tool call "${id}" was approved or rejected but was never requested`,
      }
    }
  }

  return { ok: true }
}

/** Thrown by {@link assertValidContinuation} when validation fails. */
export class ContinuationValidationError extends Error {
  readonly code: ContinuationRejectionCode
  readonly index: number | undefined
  constructor(result: ContinuationValidationResult) {
    super(`[Rudder AI] Rejected continuation: ${result.reason ?? result.code ?? 'invalid'}`)
    this.name = 'ContinuationValidationError'
    this.code = result.code ?? 'not-a-prefix'
    this.index = result.index
  }
}

/**
 * {@link validateContinuation} that throws {@link ContinuationValidationError}
 * instead of returning a verdict. Use directly, or via
 * {@link defaultContinuationValidator} as a `validate` hook.
 */
export function assertValidContinuation(
  persisted: readonly AiMessage[],
  incoming: readonly AiMessage[],
  opts: ValidateContinuationOptions = {},
): void {
  const result = validateContinuation(persisted, incoming, opts)
  if (!result.ok) throw new ContinuationValidationError(result)
}

/**
 * A ready-made {@link ContinuationValidator} backed by
 * {@link assertValidContinuation}. Drop into `AgentPromptOptions.validate`
 * for the default prefix + tool-result-forgery + approval-forgery gate:
 *
 * ```ts
 * agent.continue(id).prompt(input, { validate: defaultContinuationValidator() })
 * ```
 */
export function defaultContinuationValidator(): ContinuationValidator {
  return (persisted, incoming, opts) => assertValidContinuation(persisted, incoming, opts)
}
