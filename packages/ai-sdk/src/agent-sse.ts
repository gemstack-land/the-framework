/**
 * Named-event SSE protocol for streaming an agent loop to a browser.
 *
 * `@gemstack/ai-sdk` already ships the Vercel AI SDK data-stream protocol
 * ({@link toVercelDataStream}) - the numeric-prefix wire (`0:` / `9:` / `a:`
 * ...). This is the alternative for apps that want a plain
 * `text/event-stream` with self-describing event names that mirror the agent
 * loop's own lifecycle (`text`, `tool_call`, `tool_update`, `tool_result`,
 * `pending_client_tools`, `tool_approval_required`, `handoff`, `complete`,
 * `error`).
 *
 * Both ends live here so the wire vocabulary can never drift:
 *
 * - Server: {@link toAgentSseStream} / {@link toAgentSseResponse} project an
 *   `agent.stream()` result onto the named events and frame them as SSE.
 * - Browser: {@link readAgentStream} decodes the same events back into an
 *   {@link AgentStreamTurn} and fires per-event callbacks for UI side effects.
 *   {@link applyAgentSseEvent} is exposed so the per-event reducer can be
 *   unit-tested against a synthetic turn.
 *
 * Runtime-agnostic: uses only web globals (`ReadableStream`, `Response`,
 * `TextEncoder` / `TextDecoder`, `crypto.randomUUID`), no `node:` imports, so
 * the module is safe in the main entry and runs server-side (Node / edge) and
 * client-side alike.
 *
 * This ships the framework-generic core. App-specific events (conversation
 * ids, billing, sub-run fan-out bookkeeping, server-authoritative history
 * sync) are not part of it - emit and decode those alongside this protocol on
 * your own channel.
 */

import type {
  AgentResponse,
  AgentStreamResponse,
  AiMessage,
  FinishReason,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from './types.js'

// ─── Wire vocabulary ──────────────────────────────────────

/** The named SSE events this protocol emits, in agent-loop order. */
export type AgentSseEventName =
  | 'text'
  | 'tool_call'
  | 'tool_update'
  | 'tool_result'
  | 'pending_client_tools'
  | 'tool_approval_required'
  | 'handoff'
  | 'complete'
  | 'error'

/** What the loop parked on when it paused, surfaced on the `complete` event. */
export type AgentAwaiting = 'client_tools' | 'approval'

export interface AgentSseTextPayload { text: string }

export interface AgentSseToolCallPayload {
  id?:    string
  tool:   string
  input?: Record<string, unknown>
}

export interface AgentSseToolUpdatePayload {
  id?:    string
  tool?:  string
  update: unknown
}

export interface AgentSseToolResultPayload {
  id?:         string
  toolCallId?: string
  tool?:       string
  /** String passthrough when the tool returned a string, else JSON-encoded. */
  content:     string
}

export interface AgentSsePendingClientToolsPayload { toolCalls: ToolCall[] }

export interface AgentSseApprovalPayload {
  toolCall:     ToolCall
  isClientTool: boolean
}

export interface AgentSseHandoffPayload {
  from:     string
  to:       string
  message?: string
}

export interface AgentSseCompletePayload {
  done:          true
  finishReason?: FinishReason
  awaiting?:     AgentAwaiting
  /** Number of model steps the run took (`response.steps.length`). */
  steps?:        number
  usage?:        TokenUsage
}

export interface AgentSseErrorPayload { message: string }

// ─── Server: project a stream onto SSE ────────────────────

/** Map a finish reason to the pause it represents, if any. */
function awaitingFor(reason: FinishReason | undefined): AgentAwaiting | undefined {
  if (reason === 'client_tool_calls') return 'client_tools'
  if (reason === 'tool_approval_required') return 'approval'
  return undefined
}

function frame(event: AgentSseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Project an `agent.stream()` result onto the named-event SSE wire as a
 * `ReadableStream<Uint8Array>`.
 *
 * Iterates the chunk stream, emits one named event per loop chunk, then
 * awaits the `response` promise and emits a terminal `complete` event
 * carrying `done`, `finishReason`, the `awaiting` pause (if any), step count,
 * and usage. If iteration or the response throws, an `error` event is emitted
 * and the stream closes cleanly so the browser reader's `onError` fires.
 */
export function toAgentSseStream(streaming: AgentStreamResponse): ReadableStream<Uint8Array> {
  const { stream, response } = streaming
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const emit = (event: AgentSseEventName, data: unknown) =>
        controller.enqueue(encoder.encode(frame(event, data)))

      try {
        for await (const chunk of stream) {
          emitChunk(chunk, emit)
        }

        const res: AgentResponse = await response
        const awaiting = awaitingFor(res.finishReason)
        const complete: AgentSseCompletePayload = {
          done: true,
          steps: res.steps.length,
          usage: res.usage,
        }
        if (res.finishReason) complete.finishReason = res.finishReason
        if (awaiting) complete.awaiting = awaiting
        emit('complete', complete)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit('error', { message } satisfies AgentSseErrorPayload)
      } finally {
        controller.close()
      }
    },
  })
}

function emitChunk(chunk: StreamChunk, emit: (event: AgentSseEventName, data: unknown) => void): void {
  switch (chunk.type) {
    case 'text-delta':
      if (chunk.text) emit('text', { text: chunk.text } satisfies AgentSseTextPayload)
      return
    case 'tool-call':
      emit('tool_call', {
        ...(chunk.toolCall?.id ? { id: chunk.toolCall.id } : {}),
        tool:  chunk.toolCall?.name ?? '',
        input: chunk.toolCall?.arguments ?? {},
      } satisfies AgentSseToolCallPayload)
      return
    case 'tool-update':
      emit('tool_update', {
        ...(chunk.toolCall?.id ? { id: chunk.toolCall.id } : {}),
        ...(chunk.toolCall?.name ? { tool: chunk.toolCall.name } : {}),
        update: chunk.update,
      } satisfies AgentSseToolUpdatePayload)
      return
    case 'tool-result': {
      const id = chunk.toolCall?.id
      emit('tool_result', {
        ...(id ? { id, toolCallId: id } : {}),
        ...(chunk.toolCall?.name ? { tool: chunk.toolCall.name } : {}),
        content: typeof chunk.result === 'string' ? chunk.result : JSON.stringify(chunk.result),
      } satisfies AgentSseToolResultPayload)
      return
    }
    case 'pending-client-tools':
      emit('pending_client_tools', { toolCalls: chunk.toolCalls ?? [] } satisfies AgentSsePendingClientToolsPayload)
      return
    case 'pending-approval':
      if (chunk.toolCall) {
        emit('tool_approval_required', {
          toolCall:     chunk.toolCall as ToolCall,
          isClientTool: chunk.isClientTool ?? false,
        } satisfies AgentSseApprovalPayload)
      }
      return
    case 'handoff':
      if (chunk.handoff) emit('handoff', chunk.handoff satisfies AgentSseHandoffPayload)
      return
    // 'tool-call-delta' | 'usage' | 'finish' carry no named event - the
    // terminal `complete` event reports finish reason + usage from the
    // resolved AgentResponse.
  }
}

/**
 * Wrap {@link toAgentSseStream} in a `Response` with the standard
 * `text/event-stream` headers (no caching, no proxy buffering). Return it
 * directly from a route handler.
 */
export function toAgentSseResponse(streaming: AgentStreamResponse, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'text/event-stream; charset=utf-8')
  headers.set('Cache-Control', 'no-cache, no-transform')
  headers.set('Connection', 'keep-alive')
  // Disable nginx response buffering so events flush as they're produced.
  headers.set('X-Accel-Buffering', 'no')
  return new Response(toAgentSseStream(streaming), { ...init, headers })
}

// ─── Browser: decode SSE back into a turn ─────────────────

/**
 * The accumulated state of one streamed agent turn, built up event by event
 * by {@link readAgentStream}. Mirrors {@link AgentResponse} fields the browser
 * needs to render the turn and build the next continuation request.
 */
export interface AgentStreamTurn {
  /** Concatenated `text` event deltas. */
  assistantText:      string
  /** Tool calls stamped by `tool_call` events (for the next continuation). */
  assistantToolCalls: ToolCall[]
  /** Server-side `role:'tool'` result messages from `tool_result` events. */
  serverToolResults:  AiMessage[]
  /** Client tool calls from a `pending_client_tools` event to run locally. */
  pendingClientTools: ToolCall[]
  /** Approval pause from a `tool_approval_required` event. */
  pendingApproval:    AgentSseApprovalPayload | null
  /** Chain of agent class names traversed via `handoff` events. */
  handoffPath:        string[]
  /** `true` once a `complete` event with `done: true` arrived. */
  done:               boolean
  /** What the run paused on, from the `complete` event. */
  awaiting:           AgentAwaiting | undefined
}

/** A fresh, empty {@link AgentStreamTurn}. */
export function newAgentStreamTurn(): AgentStreamTurn {
  return {
    assistantText:      '',
    assistantToolCalls: [],
    serverToolResults:  [],
    pendingClientTools: [],
    pendingApproval:    null,
    handoffPath:        [],
    done:               false,
    awaiting:           undefined,
  }
}

/** Per-event callbacks fired by {@link readAgentStream} for UI side effects. */
export interface AgentStreamCallbacks {
  onText?:                 (text: string) => void
  onToolCall?:             (call: AgentSseToolCallPayload) => void
  onToolUpdate?:           (update: AgentSseToolUpdatePayload) => void
  onToolResult?:           (result: AgentSseToolResultPayload) => void
  onPendingClientTools?:   (toolCalls: ToolCall[]) => void
  onToolApprovalRequired?: (approval: AgentSseApprovalPayload) => void
  onHandoff?:              (handoff: AgentSseHandoffPayload) => void
  onComplete?:             (data: AgentSseCompletePayload) => void
  onError?:                (error: AgentSseErrorPayload) => void
  /** Fired for any SSE event outside the standard protocol vocabulary. Use this
   *  to observe app-specific events (e.g. a server-issued `run_started` carrying
   *  a `runId`) without consuming the response body twice. */
  onAppEvent?:             (event: string, data: unknown) => void
}

function randomId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tc-${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * Read a named-event agent-SSE response body, applying each event to a fresh
 * {@link AgentStreamTurn} and firing the matching callback. Resolves with the
 * accumulated turn once the stream closes.
 *
 * The caller owns the `fetch` and the `!resp.ok` branch (so a rich error body
 * can be read for non-2xx responses); pass an already-OK response. A missing
 * body resolves to an empty turn. Malformed event JSON is skipped.
 */
export async function readAgentStream(
  resp:       Response,
  callbacks:  AgentStreamCallbacks = {},
): Promise<AgentStreamTurn> {
  const turn = newAgentStreamTurn()
  if (!resp.body) return turn

  const reader  = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // Hoisted across reads: an `event:` line and its `data:` line can land in
  // separate `read()` chunks when the body is sliced mid-frame.
  let currentEvent = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7)
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          applyAgentSseEvent(currentEvent, JSON.parse(line.slice(6)), turn, callbacks)
        } catch { /* skip malformed JSON */ }
        currentEvent = ''
      }
    }
  }

  return turn
}

/**
 * Apply a single parsed SSE event to the turn state and fire the matching
 * callback. Mutates `turn`; otherwise pure. Exposed for unit-testing the
 * reducer against a synthetic turn without a live stream.
 */
export function applyAgentSseEvent(
  event:     string,
  data:      unknown,
  turn:      AgentStreamTurn,
  callbacks: AgentStreamCallbacks = {},
): void {
  switch (event as AgentSseEventName) {
    case 'text': {
      const d = data as AgentSseTextPayload
      turn.assistantText += d.text
      callbacks.onText?.(d.text)
      return
    }
    case 'tool_call': {
      const d = data as AgentSseToolCallPayload
      turn.assistantToolCalls.push({
        id:        d.id ?? randomId(),
        name:      d.tool,
        arguments: d.input ?? {},
      })
      callbacks.onToolCall?.(d)
      return
    }
    case 'tool_update': {
      callbacks.onToolUpdate?.(data as AgentSseToolUpdatePayload)
      return
    }
    case 'tool_result': {
      const d = data as AgentSseToolResultPayload
      const toolCallId = d.toolCallId ?? d.id
      if (toolCallId) {
        turn.serverToolResults.push({ role: 'tool', content: d.content, toolCallId })
      }
      callbacks.onToolResult?.(d)
      return
    }
    case 'pending_client_tools': {
      const d = data as AgentSsePendingClientToolsPayload
      turn.pendingClientTools = d.toolCalls ?? []
      callbacks.onPendingClientTools?.(turn.pendingClientTools)
      return
    }
    case 'tool_approval_required': {
      const d = data as AgentSseApprovalPayload
      turn.pendingApproval = { toolCall: d.toolCall, isClientTool: d.isClientTool }
      callbacks.onToolApprovalRequired?.(d)
      return
    }
    case 'handoff': {
      const d = data as AgentSseHandoffPayload
      if (turn.handoffPath.length === 0 && d.from) turn.handoffPath.push(d.from)
      if (d.to) turn.handoffPath.push(d.to)
      callbacks.onHandoff?.(d)
      return
    }
    case 'complete': {
      const d = data as AgentSseCompletePayload
      if (d.done === true) turn.done = true
      turn.awaiting = d.awaiting
      callbacks.onComplete?.(d)
      return
    }
    case 'error': {
      const d = data as AgentSseErrorPayload
      callbacks.onError?.(d)
      return
    }
    default:
      callbacks.onAppEvent?.(event, data)
  }
}
