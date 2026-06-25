import {
  applyToModelOutput,
  evaluateApproval,
  executeMaybeStreaming,
  validateToolArgs,
} from './tool-helpers.js'
import type { AgentPromptOptions, AiMessage, AnyTool, ToolCall } from './types.js'

/**
 * When continuing a chat after a stop-on-approval round-trip, the supplied
 * `messages` array ends with an `assistant` message whose `toolCalls` were
 * never fulfilled (the loop paused before executing them). Most providers
 * (Anthropic in particular) reject such conversations because every
 * `tool_use` block must be followed by a matching `tool_result`.
 *
 * This helper detects that case, executes the pending **server** tool calls
 * (honoring `approvedToolCallIds` / `rejectedToolCallIds`), appends the
 * resulting tool messages to `messages` in place, and returns them. The
 * caller can attach the returned list to `AgentResponse.resumedToolMessages`
 * so that the panels dispatcher persists them in the conversation store.
 *
 * Client tools (no `execute`) must come back from the browser with their
 * tool result already in the conversation, so the trailing assistant message
 * will not have unmatched `toolCalls` for them — they're handled outside.
 */
export async function resumePendingToolCalls(deps: {
  messages: AiMessage[]
  toolMap:  Map<string, AnyTool>
  options:  AgentPromptOptions | undefined
}): Promise<{
  resumed:               AiMessage[]
  approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined
}> {
  const { messages, toolMap, options } = deps

  // Strip trailing pending-approval placeholders from a prior partial resume.
  // They were synthesized so every `tool_use` in the parent assistant message
  // had a matching `tool_result` during the pause; on resume we re-walk the
  // parent and append fresh results (real or placeholder) based on the
  // latest approval state.
  while (messages.length > 0) {
    const tail = messages[messages.length - 1]!
    if (tail.role === 'tool' && tail._pending) {
      messages.pop()
    } else break
  }

  // Find the parent assistant message — it's the most recent assistant
  // message immediately followed only by tool messages. On a fresh pause
  // there are no tools yet; on a subsequent resume the parent is buried
  // under the real tool results we appended last time.
  let parentIdx = messages.length - 1
  while (parentIdx >= 0 && messages[parentIdx]!.role === 'tool') parentIdx--
  const last = parentIdx >= 0 ? messages[parentIdx] : undefined
  if (!last || last.role !== 'assistant' || !last.toolCalls || last.toolCalls.length === 0) {
    return { resumed: [], approvalStillRequired: undefined }
  }

  // Collect tool-call ids already resolved in a prior partial resume — those
  // trail the parent assistant as non-`_pending` tool messages. Skipping
  // them on the next walk avoids double-executing approved tools.
  const alreadyResolved = new Set<string>()
  for (let i = parentIdx + 1; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role !== 'tool') break
    if (!m._pending && m.toolCallId) alreadyResolved.add(m.toolCallId)
  }

  const resumed: AiMessage[] = []
  let approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined

  for (let i = 0; i < last.toolCalls.length; i++) {
    const tc = last.toolCalls[i]!
    if (alreadyResolved.has(tc.id)) continue

    const tool = toolMap.get(tc.name)
    if (!tool) {
      const err = `Error: Unknown tool "${tc.name}"`
      const m: AiMessage = { role: 'tool', content: err, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }
    if (!tool.execute) {
      // Client tool whose result is missing from the supplied messages.
      // Surface an error so the model can recover instead of hanging.
      const err = `Error: client tool "${tc.name}" was not executed by the browser`
      const m: AiMessage = { role: 'tool', content: err, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }

    const decision = await evaluateApproval(tool, tc, options)
    if (decision === 'rejected') {
      const rej = { rejected: true, reason: 'User rejected this tool call' }
      const m: AiMessage = { role: 'tool', content: JSON.stringify(rej), toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }
    if (decision === 'pending') {
      // Still pending — the user hasn't decided on this call yet. Stop
      // executing further tools AND synthesize placeholder tool messages for
      // every unresolved sibling (including this one), so Anthropic's
      // "every tool_use needs a matching tool_result" invariant holds while
      // the loop is paused. The next resume strips these placeholders and
      // re-walks based on the fresh approval state.
      approvalStillRequired = { toolCall: tc, isClientTool: false }
      for (let j = i; j < last.toolCalls.length; j++) {
        const sib = last.toolCalls[j]!
        if (alreadyResolved.has(sib.id)) continue
        messages.push({
          role:       'tool',
          content:    'Tool call pending user approval — execution deferred.',
          toolCallId: sib.id,
          _pending:   true,
        })
      }
      break
    }

    // Validate args before executing on resume. Approval-resume bypasses
    // middleware so we use the raw tc.arguments. On failure, feed the
    // structured error to the model so it can correct itself.
    const validation = validateToolArgs(tool, tc.arguments)
    if (!validation.ok) {
      const m: AiMessage = { role: 'tool', content: JSON.stringify(validation.error), toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }

    try {
      // Drain generator yields silently — approval-resume runs outside the
      // stream, so any preliminary updates are discarded; only the final
      // return value is captured.
      const execGen = executeMaybeStreaming(tool, validation.value, { toolCallId: tc.id })
      let result: unknown
      while (true) {
        const step = await execGen.next()
        if (step.done) { result = step.value; break }
      }
      // Approval-resume has no middleware context here, so toModelOutput
      // errors fall back silently to default stringification (R6).
      const content = await applyToModelOutput(tool, result)
      const m: AiMessage = { role: 'tool', content, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`
      const m: AiMessage = { role: 'tool', content: errMsg, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
    }
  }

  return { resumed, approvalStillRequired }
}
