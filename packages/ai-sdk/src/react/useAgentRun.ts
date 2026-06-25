import { useCallback, useRef, useState } from 'react'
import type {
  AgentSseApprovalPayload,
  AgentSseCompletePayload,
  AgentStreamCallbacks,
  AgentStreamTurn,
} from '../agent-sse.js'
import type { ToolCall } from '../types.js'
import {
  appendAgentOutput,
  driveAgentRun,
  type AgentRunOutput,
  type AgentRunRequest,
  type AgentToolResult,
} from './agent-run.js'

/**
 * Run status. While the run is paused awaiting client tools (no resolver) or an
 * approval decision, status stays `'running'` and `pendingClientTools` /
 * `pendingApproval` are populated — the UI renders the prompt and calls
 * `respond` / `approve` / `reject` to continue the same logical run.
 */
export type AgentRunStatus = 'idle' | 'running' | 'complete' | 'error'

export interface UseAgentRunOptions<TInput = unknown> {
  /**
   * Turn a run/resume intent into the streaming SSE `Response`. The app owns
   * the endpoint and request-body shape (only its route can reconstruct the
   * server-side message history); typically `fetch(endpoint, { ..., signal })`.
   */
  request:      (req: AgentRunRequest<TInput>, signal: AbortSignal) => Promise<Response>
  /**
   * Optional client-tool resolver. When set, a run that pauses awaiting client
   * tools auto-executes them and resumes; omit it to surface
   * `pendingClientTools` and resume manually via `respond`.
   */
  clientTools?: (call: ToolCall) => unknown | Promise<unknown>
  onComplete?:  (data: AgentSseCompletePayload) => void
  onError?:     (message: string) => void
  /** Fired for any SSE event outside the standard protocol vocabulary (e.g. a
   *  server-issued `run_started` carrying a correlation `runId`). Forwarded
   *  directly to `readAgentStream`'s `onAppEvent` callback. */
  onAppEvent?:  (event: string, data: unknown) => void
}

export interface UseAgentRunResult<TInput = unknown> {
  status:             AgentRunStatus
  /** Renderable transcript, accumulated across the run and every resume. */
  outputs:            AgentRunOutput[]
  /** Client-tool calls awaiting a browser round-trip (empty when auto-resolved). */
  pendingClientTools: ToolCall[]
  /** The approval gate the run parked on, or `null`. */
  pendingApproval:    AgentSseApprovalPayload | null
  error:              string | null
  /** Start a fresh run, resetting the transcript. */
  run:                (input: TInput) => Promise<void>
  /** Resume a client-tool pause with results gathered by hand. */
  respond:            (results: AgentToolResult[]) => Promise<void>
  /** Approve the pending approval gate and resume. */
  approve:            (toolCallId: string) => Promise<void>
  /** Reject the pending approval gate and resume. */
  reject:             (toolCallId: string) => Promise<void>
  /** Abort any in-flight stream and return to `idle`. */
  reset:              () => void
}

/**
 * React client runtime for the named-event agent-SSE protocol. Drives
 * `readAgentStream` (via the framework-free `driveAgentRun`), accumulates the
 * transcript, tracks run status, and surfaces pending client-tool calls and
 * approval requests with imperative `run` / `respond` / `approve` / `reject`.
 *
 * Lives behind the `@gemstack/ai-sdk/react` subpath so the main entry stays
 * runtime-agnostic (same split as `@rudderjs/sync/react`).
 *
 * @example
 * const { status, outputs, run } = useAgentRun({
 *   request: (req, signal) =>
 *     fetch('/api/agent', { method: 'POST', body: JSON.stringify(req), signal }),
 * })
 * // <button onClick={() => run('Summarize the latest report')}>Ask</button>
 */
export function useAgentRun<TInput = unknown>(
  options: UseAgentRunOptions<TInput>,
): UseAgentRunResult<TInput> {
  const [status, setStatus]                         = useState<AgentRunStatus>('idle')
  const [outputs, setOutputs]                       = useState<AgentRunOutput[]>([])
  const [pendingClientTools, setPendingClientTools] = useState<ToolCall[]>([])
  const [pendingApproval, setPendingApproval]       = useState<AgentSseApprovalPayload | null>(null)
  const [error, setError]                           = useState<string | null>(null)

  // Latest values needed by the async driver / resume actions, kept in refs so
  // the imperative callbacks don't go stale between renders.
  const optionsRef = useRef(options)
  optionsRef.current = options
  const turnRef    = useRef<AgentStreamTurn | null>(null)
  const abortRef   = useRef<AbortController | null>(null)

  // Shared loop body for both the initial run and every resume.
  const drive = useCallback(async (req: AgentRunRequest<TInput>) => {
    const opts = optionsRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('running')
    setPendingClientTools([])
    setPendingApproval(null)
    setError(null)

    let sawError: string | null = null
    const callbacks: AgentStreamCallbacks = {
      onText:                 t => setOutputs(o => appendAgentOutput(o, 'text', { text: t })),
      onToolCall:             d => setOutputs(o => appendAgentOutput(o, 'tool_call', d)),
      onToolUpdate:           d => setOutputs(o => appendAgentOutput(o, 'tool_update', d)),
      onToolResult:           d => setOutputs(o => appendAgentOutput(o, 'tool_result', d)),
      onToolApprovalRequired: d => setOutputs(o => appendAgentOutput(o, 'tool_approval_required', d)),
      onHandoff:              d => setOutputs(o => appendAgentOutput(o, 'handoff', d)),
      onError:                d => { sawError = d.message; setOutputs(o => appendAgentOutput(o, 'error', d)) },
      onComplete:             d => opts.onComplete?.(d),
      ...(opts.onAppEvent ? { onAppEvent: opts.onAppEvent } : {}),
    }

    try {
      const turn = await driveAgentRun(req, {
        request:     opts.request,
        callbacks,
        signal:      controller.signal,
        ...(opts.clientTools ? { clientTools: opts.clientTools } : {}),
      })
      if (controller.signal.aborted) return
      turnRef.current = turn

      if (sawError !== null) {
        setStatus('error')
        setError(sawError)
        opts.onError?.(sawError)
        return
      }
      // Parked on an approval gate, or on client tools with no resolver:
      // surface the prompt and keep the run logically open.
      if (turn.awaiting === 'approval' && turn.pendingApproval) {
        setPendingApproval(turn.pendingApproval)
        return
      }
      if (turn.awaiting === 'client_tools' && turn.pendingClientTools.length > 0) {
        setPendingClientTools(turn.pendingClientTools)
        return
      }
      setStatus('complete')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      setStatus('error')
      setError(message)
      optionsRef.current.onError?.(message)
    }
  }, [])

  const run = useCallback(async (input: TInput) => {
    turnRef.current = null
    setOutputs([])
    await drive({ type: 'run', input })
  }, [drive])

  const respond = useCallback(async (results: AgentToolResult[]) => {
    const turn = turnRef.current
    if (!turn) return
    await drive({ type: 'resume', turn, clientToolResults: results, approved: [], rejected: [] })
  }, [drive])

  const approve = useCallback(async (toolCallId: string) => {
    const turn = turnRef.current
    if (!turn) return
    await drive({ type: 'resume', turn, clientToolResults: [], approved: [toolCallId], rejected: [] })
  }, [drive])

  const reject = useCallback(async (toolCallId: string) => {
    const turn = turnRef.current
    if (!turn) return
    await drive({ type: 'resume', turn, clientToolResults: [], approved: [], rejected: [toolCallId] })
  }, [drive])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    turnRef.current  = null
    setStatus('idle')
    setOutputs([])
    setPendingClientTools([])
    setPendingApproval(null)
    setError(null)
  }, [])

  return { status, outputs, pendingClientTools, pendingApproval, error, run, respond, approve, reject, reset }
}
