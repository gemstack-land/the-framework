import type { Agent } from './agent.js'
import type { HandoffSpec } from './handoff.js'
import type { AgentPromptOptions, AgentResponse, AgentStep, AiMessage, TokenUsage } from './types.js'

/**
 * Hard ceiling for the number of agent-to-agent handoffs in a single
 * `prompt()` / `stream()` call. Most workflows hop once or twice (triage →
 * specialist). Anything beyond this almost certainly means the agents are
 * cycling — surfacing a clear error beats silently looping until token
 * budgets explode.
 */
export const MAX_HANDOFFS = 5

/**
 * Internal record of a pending handoff carried from the loop to the
 * handoff-aware wrapper. Not part of the public surface.
 */
export interface PendingHandoff {
  spec:              HandoffSpec
  transitionMessage: string
  parentToolCallId:  string
}

/**
 * Signature of `runAgentLoopOnce` from `agent.ts`, injected so this module
 * doesn't import its caller and create a runtime cycle.
 */
export type RunOnce = (a: Agent, input: string, options?: AgentPromptOptions) =>
  Promise<AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] }>

function addUsage(total: TokenUsage, step: TokenUsage): void {
  total.promptTokens     += step.promptTokens
  total.completionTokens += step.completionTokens
  total.totalTokens      += step.totalTokens
}

/**
 * Iteratively drive pending handoffs, carrying steps + usage forward.
 * Used by the non-streaming path. (Streaming has its own iterative driver
 * inline so chunks can flow as each hop's loop runs.)
 */
export async function driveHandoffs(
  rootName:        string,
  rootResult:      AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] },
  pending:         PendingHandoff,
  carriedMessages: AiMessage[],
  origOptions:     AgentPromptOptions | undefined,
  startHopCount:   number,
  runOnce:         RunOnce,
): Promise<AgentResponse> {
  const mergedSteps: AgentStep[] = [...rootResult.steps]
  const mergedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  addUsage(mergedUsage, rootResult.usage)

  const handoffPath: string[] = [rootName]
  let currentPending = pending
  let currentCarried = carriedMessages
  let hopCount = startHopCount

  for (;;) {
    if (hopCount >= MAX_HANDOFFS) {
      throw new Error(`[Rudder AI] Exceeded max handoffs (${MAX_HANDOFFS}). Likely a cycle between agents.`)
    }
    const ChildClass = currentPending.spec.AgentClass
    handoffPath.push(ChildClass.name)
    const child = new (ChildClass as new () => Agent)()
    const childOpts = buildHandoffChildOptions(origOptions, currentCarried)
    const childOnce = await runOnce(child, currentPending.transitionMessage, childOpts)

    mergedSteps.push(...childOnce.steps)
    addUsage(mergedUsage, childOnce.usage)

    if (childOnce._pendingHandoff) {
      currentPending = childOnce._pendingHandoff
      currentCarried = childOnce._carriedMessages ?? []
      hopCount++
      continue
    }

    return {
      ...stripInternal(childOnce),
      steps: mergedSteps,
      usage: mergedUsage,
      handoffPath,
    }
  }
}

/** Merge the terminal hop's response with carried steps / usage / path. */
export function mergeFinalHandoff(
  terminal:     AgentResponse,
  mergedSteps:  AgentStep[],
  mergedUsage:  TokenUsage,
  pathPrefix:   string[],
  terminalName: string,
): AgentResponse {
  return {
    ...terminal,
    steps: mergedSteps,
    usage: mergedUsage,
    handoffPath: [...pathPrefix, terminalName],
  }
}

/**
 * Build the {@link AgentPromptOptions} for a child agent invoked via
 * handoff. The parent's carried message log replaces the child's input
 * (so the child sees the full conversation up to the handoff point) but
 * the child still prepends its own `instructions()` as the system message
 * during initialization, so we drop the parent's leading system message
 * to avoid double-prefixing.
 *
 * Per-call options that make sense to carry across (signal, attachments,
 * tool/middleware overrides) are preserved; `messages` and `history` are
 * deliberately overridden.
 */
export function buildHandoffChildOptions(
  parentOptions:   AgentPromptOptions | undefined,
  carriedMessages: AiMessage[],
): AgentPromptOptions {
  const stripped = carriedMessages.length > 0 && carriedMessages[0]?.role === 'system'
    ? carriedMessages.slice(1)
    : carriedMessages
  return {
    ...(parentOptions ?? {}),
    messages: stripped,
  }
}

/** Strip the internal `_pendingHandoff` / `_carriedMessages` fields before surfacing the response to public callers. */
export function stripInternal(r: AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] }): AgentResponse {
  const out: AgentResponse = {
    text:  r.text,
    steps: r.steps,
    usage: r.usage,
  }
  if (r.conversationId !== undefined) out.conversationId = r.conversationId
  if (r.finishReason !== undefined) out.finishReason = r.finishReason
  if (r.pendingClientToolCalls !== undefined) out.pendingClientToolCalls = r.pendingClientToolCalls
  if (r.pendingApprovalToolCall !== undefined) out.pendingApprovalToolCall = r.pendingApprovalToolCall
  if (r.resumedToolMessages !== undefined) out.resumedToolMessages = r.resumedToolMessages
  if (r.handoffPath !== undefined) out.handoffPath = r.handoffPath
  return out
}
