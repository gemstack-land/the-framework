/**
 * Framework-free core of the `useAgentRun` React hook.
 *
 * The React hook (`useAgentRun.ts`) is a thin wrapper around the pieces here —
 * same posture as `@rudderjs/sync`'s `CollabRoomManager` vs `useCollabRoom`:
 * keeping the state machine and the stream-driving loop out of React lets us
 * exhaustively unit-test the client-tool round-trip and the approval resume
 * without a React testing harness (the framework intentionally ships none).
 *
 * Builds on the named-event agent-SSE protocol in `../agent-sse.ts`
 * (`readAgentStream` + the `AgentStreamTurn` it accumulates). No `react` and no
 * `node:` imports — safe in any `fetch`-capable runtime.
 */

import { readAgentStream } from '../agent-sse.js'
import type {
  AgentSseApprovalPayload,
  AgentSseToolCallPayload,
  AgentSseToolResultPayload,
  AgentSseToolUpdatePayload,
  AgentSseHandoffPayload,
  AgentStreamCallbacks,
  AgentStreamTurn,
} from '../agent-sse.js'
import type { ToolCall } from '../types.js'

// ─── Output entries ───────────────────────────────────────

/** One renderable entry in a run's transcript, in arrival order. */
export type AgentRunOutput =
  | { type: 'text';             text: string }
  | { type: 'tool_call';        id?: string; tool: string; input?: Record<string, unknown> }
  | { type: 'tool_update';      id?: string; tool?: string; update: unknown }
  | { type: 'tool_result';      id?: string; tool?: string; content: string }
  | { type: 'approval_request'; toolCall: ToolCall; isClientTool: boolean }
  | { type: 'handoff';          from: string; to: string; message?: string }
  | { type: 'error';            message: string }

/**
 * Append one decoded SSE event to the output transcript, returning a NEW array
 * (so a React consumer can use it as immutable state). Consecutive `text`
 * deltas coalesce into the trailing text entry so streamed text renders as one
 * growing block. `complete` and `pending_client_tools` produce no transcript
 * entry — they drive run status / pending-action state instead.
 */
export function appendAgentOutput(outputs: AgentRunOutput[], event: string, data: unknown): AgentRunOutput[] {
  switch (event) {
    case 'text': {
      const text = (data as { text?: string }).text ?? ''
      if (!text) return outputs
      const last = outputs[outputs.length - 1]
      if (last && last.type === 'text') {
        return [...outputs.slice(0, -1), { type: 'text', text: last.text + text }]
      }
      return [...outputs, { type: 'text', text }]
    }
    case 'tool_call': {
      const d = data as AgentSseToolCallPayload
      return [...outputs, { type: 'tool_call', ...(d.id ? { id: d.id } : {}), tool: d.tool, ...(d.input ? { input: d.input } : {}) }]
    }
    case 'tool_update': {
      const d = data as AgentSseToolUpdatePayload
      return [...outputs, { type: 'tool_update', ...(d.id ? { id: d.id } : {}), ...(d.tool ? { tool: d.tool } : {}), update: d.update }]
    }
    case 'tool_result': {
      const d = data as AgentSseToolResultPayload
      const id = d.toolCallId ?? d.id
      return [...outputs, { type: 'tool_result', ...(id ? { id } : {}), ...(d.tool ? { tool: d.tool } : {}), content: d.content }]
    }
    case 'tool_approval_required': {
      const d = data as AgentSseApprovalPayload
      return [...outputs, { type: 'approval_request', toolCall: d.toolCall, isClientTool: d.isClientTool }]
    }
    case 'handoff': {
      const d = data as AgentSseHandoffPayload
      return [...outputs, { type: 'handoff', from: d.from, to: d.to, ...(d.message ? { message: d.message } : {}) }]
    }
    case 'error': {
      const d = data as { message?: string }
      return [...outputs, { type: 'error', message: d.message ?? 'Unknown error' }]
    }
    default:
      return outputs
  }
}

// ─── Client-tool round-trip ───────────────────────────────

/** A client-executed tool result, keyed to its originating tool call. */
export interface AgentToolResult {
  toolCallId: string
  result:     unknown
}

/**
 * Run each pending client-tool call through the resolver, in order, collecting
 * results keyed by `toolCallId`. A resolver that throws yields an
 * `{ error }` result rather than aborting the batch — the model sees the
 * failure as that tool's result and can recover, matching the server-side
 * tool-error posture.
 */
export async function executeClientTools(
  calls:    ToolCall[],
  resolver: (call: ToolCall) => unknown | Promise<unknown>,
): Promise<AgentToolResult[]> {
  const results: AgentToolResult[] = []
  for (const call of calls) {
    try {
      results.push({ toolCallId: call.id, result: await resolver(call) })
    } catch (err) {
      results.push({ toolCallId: call.id, result: { error: err instanceof Error ? err.message : String(err) } })
    }
  }
  return results
}

// ─── Run/resume request shape + driver ────────────────────

/**
 * The intent the consumer's `request` function turns into an SSE `Response`.
 * The hook owns the run/resume state machine; the app owns the endpoint and
 * the request body shape (only the app's route knows how to reconstruct the
 * server-side message history), so the driver hands it a typed intent and
 * expects a streaming `Response` back.
 */
export type AgentRunRequest<TInput = unknown> =
  | { type: 'run';    input: TInput }
  | {
      type:              'resume'
      /** The accumulated turn the resume continues from. */
      turn:              AgentStreamTurn
      /** Results from client-tool calls executed in the browser. */
      clientToolResults: AgentToolResult[]
      /** Tool-call ids the user approved. */
      approved:          string[]
      /** Tool-call ids the user rejected. */
      rejected:          string[]
    }

export interface AgentRunDriverOptions<TInput = unknown> {
  /** Turn a run/resume intent into the streaming SSE `Response`. */
  request:      (req: AgentRunRequest<TInput>, signal: AbortSignal) => Promise<Response>
  /**
   * Optional client-tool resolver. When provided, a run that pauses awaiting
   * client tools auto-executes them and resumes — no manual `respond`. Omit it
   * to surface the pending calls and resume by hand.
   */
  clientTools?: (call: ToolCall) => unknown | Promise<unknown>
  /** Forwarded to `readAgentStream` so the consumer sees events as they arrive. */
  callbacks?:   AgentStreamCallbacks
  signal:       AbortSignal
}

/**
 * Drive one logical agent run to a settling point: stream the response,
 * accumulate the turn, and — when a client-tool resolver is configured —
 * auto-resume across client-tool pauses until the run completes or parks on an
 * approval gate / manual client-tool round-trip. Returns the final
 * {@link AgentStreamTurn}. Framework-free; the hook wires `callbacks` to state.
 */
export async function driveAgentRun<TInput = unknown>(
  initial: AgentRunRequest<TInput>,
  opts:    AgentRunDriverOptions<TInput>,
): Promise<AgentStreamTurn> {
  let req = initial
  for (;;) {
    const resp = await opts.request(req, opts.signal)
    if (!resp.ok) {
      throw new Error(`Agent stream request failed with status ${resp.status}.`)
    }
    const turn = await readAgentStream(resp, opts.callbacks)

    // Auto-resume only across client-tool pauses, and only with a resolver.
    // Approval pauses always park for an explicit approve/reject decision.
    if (turn.awaiting === 'client_tools' && opts.clientTools && turn.pendingClientTools.length > 0) {
      const clientToolResults = await executeClientTools(turn.pendingClientTools, opts.clientTools)
      req = { type: 'resume', turn, clientToolResults, approved: [], rejected: [] }
      continue
    }
    return turn
  }
}
