/**
 * Make a loaded conversation history safe to replay against any provider by
 * enforcing the tool-call / tool-result invariant in BOTH directions.
 *
 * Anthropic's Messages API requires every `tool_use` block to be followed by
 * `tool_result` blocks for all of its ids. OpenAI-compatible providers
 * (DeepSeek, OpenRouter, Azure) are stricter still: a `role:'tool'` message
 * must immediately follow the `assistant` + `tool_calls` that declared its id,
 * and an unanswered `tool_calls` is equally rejected, surfacing as
 * `400 Messages with role 'tool' must be a response to a preceding message
 * with 'tool_calls'`. A conversation interrupted mid-turn (a crash after the
 * assistant message persisted but before all tool results landed; a client
 * failure that never replayed the results) leaves a malformed graph in the
 * store, and replaying it 400s.
 *
 * {@link sanitizeConversation} walks the messages in order:
 *
 *   - **Complete tool turn** (every declared id has a matching result in the
 *     immediately-following tool run) is kept, with the results re-emitted in
 *     `toolCalls` order, exactly one per call. Any extra / duplicate / orphan
 *     tool message interleaved in that run is dropped.
 *   - **Dangling tool turn** (one or more declared ids unanswered) has its
 *     assistant `toolCalls` stripped; the text `content` is preserved as a
 *     plain assistant message (an empty one is dropped entirely); the partial
 *     tool results are dropped.
 *   - **Orphan tool result** (a `role:'tool'` message whose parent assistant
 *     is missing or was dropped as dangling) is dropped. Replaying it trips
 *     the 400 above on OpenAI-compatible providers and a BadRequestError on
 *     Anthropic.
 *
 * Unlike the wire-level normalizer the provider adapters apply (which
 * SYNTHESIZES stub results so an in-flight request stays well-formed), the
 * load boundary DROPS incomplete turns: an interrupted turn is abandoned
 * history, and a fake "result missing" message would pollute the model's
 * future context.
 *
 * Pure and idempotent: safe to apply at any load boundary, and re-running over
 * an already-sanitized array is a no-op. {@link OrmConversationStore} applies
 * it in `load()` so persisted histories are replay-safe by default.
 */

import type { AiMessage } from './types.js'

export function sanitizeConversation(messages: AiMessage[]): AiMessage[] {
  const result: AiMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!

    // A `tool` message reaching the top level was not consumed by a complete
    // assistant turn below (those advance `i` past their results), so its
    // parent is missing or was dropped as dangling. It is an orphan; drop it.
    if (msg.role === 'tool') continue

    if (msg.role !== 'assistant' || !msg.toolCalls?.length) {
      result.push(msg)
      continue
    }

    const wanted = msg.toolCalls.map(tc => tc.id).filter(Boolean)

    // Map the immediately-following tool run by id (first result per id wins).
    const resultsById = new Map<string, AiMessage>()
    let j = i + 1
    while (j < messages.length && messages[j]!.role === 'tool') {
      const t = messages[j]!
      const tid = t.toolCallId
      if (tid && !resultsById.has(tid)) resultsById.set(tid, t)
      j++
    }

    const allCovered = wanted.every(id => resultsById.has(id))
    if (allCovered) {
      // Emit the assistant followed by exactly one result per call, in
      // `toolCalls` order. This normalizes ordering and drops any extra /
      // orphan tool message that was interleaved in the run.
      result.push(msg)
      for (const tc of msg.toolCalls) result.push(resultsById.get(tc.id)!)
      i = j - 1
      continue
    }

    // Dangling: strip toolCalls, drop the partial tool results, keep any text.
    const text = typeof msg.content === 'string' ? msg.content : ''
    if (text.trim() !== '') {
      result.push({ role: 'assistant', content: msg.content })
    }
    i = j - 1
  }

  return result
}
