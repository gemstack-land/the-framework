import type { LoopContext } from './agent.js'
import { isHandoffTool } from './handoff.js'
import {
  runOnAbort,
  runOnAfterToolCall,
  runOnBeforeToolCall,
  runOnChunk,
  runOnError,
  runSequential,
} from './middleware.js'
import { isPauseForApprovalChunk, isPauseForClientToolsChunk } from './tool.js'
import {
  applyToModelOutput,
  evaluateApproval,
  executeMaybeStreaming,
  validateToolArgs,
} from './tool-helpers.js'
import type { InvalidToolArgumentsError } from './tool-helpers.js'
import type { AiMessage, AnyTool, StreamChunk, ToolCall, ToolResult } from './types.js'

/**
 * Execute the tool phase for a single agent step. Yields the same
 * `StreamChunk` sequence (`tool-call` → `tool-update*` → `tool-result`) that
 * the streaming caller surfaces to consumers. Non-streaming callers iterate
 * via `.next()` and discard yields — the side effects (message pushes,
 * pending-state mutations on `loopCtx`) are identical regardless of whether
 * the chunks reach a consumer.
 *
 * Returns the step's `ToolResult[]`. The caller passes the assistant message
 * to push before iteration so the AgentStep shape (response.message) and the
 * final `messages` array stay in sync with the loop variant.
 */
export async function* executeToolPhase(
  loopCtx:          LoopContext,
  toolCalls:        ToolCall[],
  assistantMessage: AiMessage,
): AsyncGenerator<StreamChunk, ToolResult[], void> {
  const { messages, middlewares, options, ctx } = loopCtx
  const toolResults: ToolResult[] = []

  messages.push(assistantMessage)

  // Resolve parallelism setting. Per-call option wins; falls back to the
  // agent-level override which defaults to `true`. Single-tool batches
  // route through the serial path either way (no parallelism to gain, and
  // serial preserves live `tool-update` streaming for that one tool).
  const parallel = (options?.parallelTools ?? loopCtx.agent.parallelTools()) && toolCalls.length > 1

  if (parallel) {
    yield* runToolPhaseParallel(loopCtx, toolCalls, toolResults)
  } else {
    yield* runToolPhaseSerial(loopCtx, toolCalls, toolResults)
  }

  // onToolPhaseComplete
  if (middlewares.length > 0) await runSequential(middlewares, 'onToolPhaseComplete', ctx)

  return toolResults
}

/**
 * Serial tool execution — the original behavior. Decides each tool call's
 * fate and runs its `execute()` one-after-another, streaming `tool-update`
 * chunks live as the tool emits them.
 */
async function* runToolPhaseSerial(
  loopCtx:     LoopContext,
  toolCalls:   ToolCall[],
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  const { messages, middlewares, ctx } = loopCtx

  for (const tc of toolCalls) {
    const decision = await decideToolCall(loopCtx, tc)

    if (decision.kind !== 'ready') {
      yield* emitDecision(loopCtx, decision, toolResults)
      if (haltsToolPhase(decision)) break
      continue
    }

    const toolStart = performance.now()
    try {
      // Emit the tool-call marker before execution so streaming UIs see
      // tool-call → tool-update* → tool-result in order. Async-generator
      // executes stream their yields as tool-update chunks live; plain
      // executes yield nothing here.
      yield { type: 'tool-call' as const, toolCall: tc }
      const exec = yield* runToolExecution(loopCtx, decision)
      yield* emitExecutionResult(loopCtx, decision, exec, toolResults)
    } catch (err: unknown) {
      // `runToolExecution` already funnels `execute()` throws into an
      // `error` outcome, so only the post-execution hooks (a rejecting
      // `onAfterToolCall`/`onError`) can land here. Serial has always
      // reported those as the tool's result; the parallel replay lets them
      // propagate. See #971 — the two are deliberately left as they were.
      const duration = performance.now() - toolStart
      const msg = err instanceof Error ? err.message : String(err)
      const errResult = `Error: ${msg}`
      toolResults.push({ toolCallId: tc.id, result: errResult, duration })
      messages.push({ role: 'tool', content: errResult, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: errResult }

      // onAfterToolCall (error case)
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, decision.toolArgs, errResult)
    }
  }
}

/**
 * Parallel tool execution — three phases:
 *
 * 1. **Prelude (serial, in tool-call order):** run {@link decideToolCall}
 *    for each call. Approval decisions, `onBeforeToolCall` middleware, and
 *    arg validation all resolve here; the next phase only sees calls that
 *    cleared every gate. `pending-approval` and `mw-abort` short-circuit the
 *    prelude exactly as they do in serial mode — later calls are never
 *    dispatched. A handoff does the same by flipping `loopCtx.stopForHandoff`,
 *    which turns every later call into `handoff-skipped`.
 *
 * 2. **Execution (parallel):** for every `ready` decision, drive
 *    `executeMaybeStreaming` to completion concurrently. `tool-update`
 *    chunks (and any pause-for-client-tools mutations to `loopCtx`) are
 *    captured per-call into a buffer.
 *
 * 3. **Replay (serial, in tool-call order):** for each decision, emit its
 *    chunks (including buffered `tool-update`s for ready calls), push
 *    tool messages, and run `onAfterToolCall`. This is the only phase
 *    that yields chunks to consumers, so streamed output stays
 *    deterministic regardless of which `execute()` finished first.
 */
async function* runToolPhaseParallel(
  loopCtx:     LoopContext,
  toolCalls:   ToolCall[],
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  // ─── Phase 1: prelude ──────────────────────────────────
  const decisions: ToolCallDecision[] = []
  for (const tc of toolCalls) {
    const decision = await decideToolCall(loopCtx, tc)
    // Halting decisions are kept in the list so Phase 3 emits everything
    // up to and including them, exactly as serial does before it breaks.
    decisions.push(decision)
    if (haltsToolPhase(decision)) break
  }

  // ─── Phase 2: dispatch ready executions concurrently ──
  const ready = decisions.filter((d): d is ReadyDecision => d.kind === 'ready')
  const executions = await Promise.all(ready.map(d => bufferToolExecution(loopCtx, d)))
  const executionByCallId = new Map<string, BufferedExecution>()
  for (let i = 0; i < ready.length; i++) {
    executionByCallId.set(ready[i]!.tc.id, executions[i]!)
  }

  // ─── Phase 3: replay chunks + side-effects in order ───
  for (const decision of decisions) {
    if (decision.kind !== 'ready') {
      yield* emitDecision(loopCtx, decision, toolResults)
      if (haltsToolPhase(decision)) break
      continue
    }
    const buffered = executionByCallId.get(decision.tc.id)!
    yield { type: 'tool-call' as const, toolCall: decision.tc }
    for (const chunk of buffered.updates) yield chunk
    yield* emitExecutionResult(loopCtx, decision, buffered.exec, toolResults)
  }
}

// ─── The shared gate chain ───────────────────────────────

type ReadyDecision = {
  kind:          'ready'
  tc:            ToolCall
  tool:          AnyTool
  toolArgs:      Record<string, unknown>
  validatedArgs: Record<string, unknown>
}

type NonReadyDecision =
  | { kind: 'unknown-tool';             tc: ToolCall; result: string }
  | { kind: 'handoff-skipped';          tc: ToolCall; result: string }
  | { kind: 'handoff';                  tc: ToolCall; result: string; chunk: StreamChunk }
  | { kind: 'client-tool-placeholder';  tc: ToolCall; result: string }
  | { kind: 'client-tool-stop';         tc: ToolCall }
  | { kind: 'rejected';                 tc: ToolCall; result: { rejected: true; reason: string } }
  | { kind: 'pending-approval';         tc: ToolCall }
  | { kind: 'mw-skip';                  tc: ToolCall; toolArgs: Record<string, unknown>; result: unknown }
  | { kind: 'mw-abort';                 tc: ToolCall }
  | { kind: 'validation-error';         tc: ToolCall; toolArgs: Record<string, unknown>; error: InvalidToolArgumentsError }

type ToolCallDecision = NonReadyDecision | ReadyDecision

/** Decisions after which no further tool call in the step is dispatched. */
function haltsToolPhase(decision: ToolCallDecision): boolean {
  return decision.kind === 'pending-approval' || decision.kind === 'mw-abort'
}

/**
 * Decide a single tool call's fate. This is the one place every gate lives
 * (#971) — unknown tool, handoff, client tool, approval, `onBeforeToolCall`
 * middleware, argument validation — so both the serial and the parallel
 * path see identical semantics and a new gate is written once.
 *
 * Side effects that the rest of the loop depends on (the pending-state
 * mutations on `loopCtx`, `onAbort` middleware) are applied here, before the
 * decision is returned. Nothing between a mutation and its emitted chunks
 * observes `loopCtx`, so applying them up front in the parallel prelude is
 * indistinguishable from applying them mid-stream in serial mode.
 */
async function decideToolCall(loopCtx: LoopContext, tc: ToolCall): Promise<ToolCallDecision> {
  const { middlewares, toolMap, options, ctx } = loopCtx

  const tool = toolMap.get(tc.name)
  if (!tool) {
    return { kind: 'unknown-tool', tc, result: `Error: Unknown tool "${tc.name}"` }
  }

  // Handoff — detected before the no-execute (client tool) branch because
  // a handoff tool also has no `execute`, but it has wholly different
  // semantics: pivot control to a new agent instead of pausing for the
  // browser. The first handoff in a step wins; any subsequent tool calls
  // in the same step are skipped with a synthetic "skipped: handed off"
  // tool result so the message log stays well-formed for replay.
  if (loopCtx.stopForHandoff) {
    return { kind: 'handoff-skipped', tc, result: 'Skipped: parent agent handed off to another agent.' }
  }
  if (isHandoffTool(tool)) {
    const spec = tool.__handoffSpec
    const validation = validateToolArgs(tool, tc.arguments)
    // Handoff payload defaults to `{ message: string }`; custom schemas
    // are accepted but the loop only uses `args.message` (string) as the
    // transition prompt. Anything else surfaces in the conversation as
    // the args of the synthetic tool-call.
    const args = validation.ok ? (validation.value as Record<string, unknown>) : (tc.arguments as Record<string, unknown>)
    const transitionMessage = typeof args['message'] === 'string' ? (args['message'] as string) : ''

    loopCtx.pendingHandoff = { spec, transitionMessage, parentToolCallId: tc.id }
    // Set before the sibling calls are decided so they resolve to
    // `handoff-skipped` — in the parallel prelude that is what stops a
    // sibling from ever being dispatched.
    loopCtx.stopForHandoff = true

    return {
      kind:   'handoff',
      tc,
      result: `Handed off to ${spec.AgentClass.name}.`,
      chunk:  {
        type:    'handoff' as const,
        handoff: {
          from: loopCtx.agent.constructor.name,
          to:   spec.AgentClass.name,
          ...(transitionMessage ? { message: transitionMessage } : {}),
        },
      },
    }
  }

  if (!tool.execute) {
    // Client tool — no server-side handler.
    if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
      loopCtx.pendingClientToolCalls.push(tc)
      loopCtx.loopFinishReason = 'client_tool_calls'
      loopCtx.stopForClientTools = true
      return { kind: 'client-tool-stop', tc }
    }
    return { kind: 'client-tool-placeholder', tc, result: '[client tool — execute on client]' }
  }

  // needsApproval enforcement
  const approvalDecision = await evaluateApproval(tool, tc, options)
  if (approvalDecision === 'rejected') {
    return { kind: 'rejected', tc, result: { rejected: true, reason: 'User rejected this tool call' } }
  }
  if (approvalDecision === 'pending') {
    loopCtx.pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
    loopCtx.loopFinishReason = 'tool_approval_required'
    loopCtx.stopForApproval = true
    return { kind: 'pending-approval', tc }
  }

  // onBeforeToolCall
  let toolArgs = tc.arguments
  if (middlewares.length > 0) {
    const beforeResult = await runOnBeforeToolCall(middlewares, ctx, tc.name, toolArgs)
    if (beforeResult) {
      if (beforeResult.type === 'skip') {
        return { kind: 'mw-skip', tc, toolArgs, result: beforeResult.result }
      }
      if (beforeResult.type === 'abort') {
        await runOnAbort(middlewares, ctx, beforeResult.reason)
        return { kind: 'mw-abort', tc }
      }
      if (beforeResult.type === 'transformArgs') {
        toolArgs = beforeResult.args
      }
    }
  }

  // Validate args against the tool's inputSchema. Runs after middleware
  // transforms so transforms can reshape malformed model output before
  // it is judged. The tool-call chunk is emitted even on validation
  // failure so streaming UIs see a paired tool-call → tool-result(error)
  // sequence; non-streaming callers discard the chunk.
  const validation = validateToolArgs(tool, toolArgs)
  if (!validation.ok) {
    return { kind: 'validation-error', tc, toolArgs, error: validation.error }
  }

  return { kind: 'ready', tc, tool, toolArgs, validatedArgs: validation.value }
}

/**
 * Emit the chunks, message pushes, and `onAfterToolCall` hook for every
 * decision that does not reach `execute()`. Shared by both paths so the
 * observable sequence for a gated call is identical in serial and parallel
 * mode. Ready decisions are handled by {@link emitExecutionResult} instead.
 */
async function* emitDecision(
  loopCtx:     LoopContext,
  decision:    NonReadyDecision,
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  const { messages, middlewares, ctx } = loopCtx
  const tc = decision.tc

  switch (decision.kind) {
    case 'unknown-tool': {
      toolResults.push({ toolCallId: tc.id, result: decision.result })
      messages.push({ role: 'tool', content: decision.result, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.result }
      return
    }
    case 'handoff-skipped': {
      toolResults.push({ toolCallId: tc.id, result: decision.result })
      messages.push({ role: 'tool', content: decision.result, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.result }
      return
    }
    case 'handoff': {
      toolResults.push({ toolCallId: tc.id, result: decision.result })
      messages.push({ role: 'tool', content: decision.result, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.result }
      yield decision.chunk
      return
    }
    case 'client-tool-stop': {
      // loopCtx mutations already applied by decideToolCall.
      yield { type: 'tool-call' as const, toolCall: tc }
      return
    }
    case 'client-tool-placeholder': {
      toolResults.push({ toolCallId: tc.id, result: decision.result })
      messages.push({ role: 'tool', content: decision.result, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.result }
      return
    }
    case 'rejected': {
      toolResults.push({ toolCallId: tc.id, result: decision.result })
      messages.push({ role: 'tool', content: JSON.stringify(decision.result), toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.result }
      return
    }
    case 'pending-approval': {
      // loopCtx mutations already applied by decideToolCall.
      yield { type: 'tool-call' as const, toolCall: tc }
      return
    }
    case 'mw-skip': {
      const resultStr = typeof decision.result === 'string' ? decision.result : JSON.stringify(decision.result)
      toolResults.push({ toolCallId: tc.id, result: decision.result })
      messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.result }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, decision.toolArgs, decision.result)
      return
    }
    case 'mw-abort': {
      // `onAbort` already ran in decideToolCall; the aborted call emits
      // nothing and the caller halts the phase.
      return
    }
    case 'validation-error': {
      yield { type: 'tool-call' as const, toolCall: tc }
      toolResults.push({ toolCallId: tc.id, result: decision.error })
      messages.push({ role: 'tool', content: JSON.stringify(decision.error), toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: decision.error }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, decision.toolArgs, decision.error)
      return
    }
  }
}

// ─── Shared execution ────────────────────────────────────

type ToolExecutionResult =
  | { kind: 'ok';     result: unknown; duration: number }
  | { kind: 'paused';                  duration: number }
  | { kind: 'error';  error: Error;    duration: number }

/**
 * Drive a single tool's `executeMaybeStreaming` to completion, yielding each
 * `tool-update` chunk and returning the outcome. Serial delegates with
 * `yield*` so updates stream live; parallel drains it through
 * {@link bufferToolExecution} so they replay in tool-call order.
 *
 * Pause detection: a yielded `pause_for_client_tools` control chunk halts
 * iteration, propagates the nested calls to the parent's pending list, and
 * returns `paused` so the caller SKIPS the tool_result emission — the
 * yielding tool's own call stays orphaned in the parent message history
 * until the caller resolves it on resume.
 */
async function* runToolExecution(
  loopCtx:  LoopContext,
  decision: ReadyDecision,
): AsyncGenerator<StreamChunk, ToolExecutionResult, void> {
  const { middlewares, ctx } = loopCtx
  const toolStart = performance.now()
  try {
    const execGen = executeMaybeStreaming(decision.tool, decision.validatedArgs, { toolCallId: decision.tc.id })
    let result: unknown
    let paused = false
    while (true) {
      const step = await execGen.next()
      if (step.done) {
        result = step.value
        break
      }
      if (isPauseForClientToolsChunk(step.value)) {
        for (const pending of step.value.toolCalls) {
          loopCtx.pendingClientToolCalls.push(pending)
        }
        loopCtx.loopFinishReason = 'client_tool_calls'
        loopCtx.stopForClientTools = true
        paused = true
        break
      }
      if (isPauseForApprovalChunk(step.value)) {
        loopCtx.pendingApprovalToolCall = {
          toolCall:     step.value.toolCall,
          isClientTool: step.value.isClientTool,
        }
        loopCtx.loopFinishReason = 'tool_approval_required'
        loopCtx.stopForApproval = true
        paused = true
        break
      }
      const updateChunk: StreamChunk = { type: 'tool-update', toolCall: decision.tc, update: step.value }
      if (middlewares.length > 0) {
        const transformed = runOnChunk(middlewares, ctx, updateChunk)
        if (transformed) yield transformed
      } else {
        yield updateChunk
      }
    }
    const duration = performance.now() - toolStart
    if (paused) return { kind: 'paused', duration }
    return { kind: 'ok', result, duration }
  } catch (err) {
    const duration = performance.now() - toolStart
    return { kind: 'error', error: err instanceof Error ? err : new Error(String(err)), duration }
  }
}

type BufferedExecution = { exec: ToolExecutionResult; updates: StreamChunk[] }

/**
 * Run {@link runToolExecution} to completion, buffering its `tool-update`
 * chunks instead of streaming them. Concurrent invocations share `ctx`:
 * middleware that writes through `ctx` during `runOnChunk` (uncommon — most
 * use it read-only for telemetry) may observe interleaved updates from
 * sibling tool calls; apps with such middleware should opt out via
 * `parallelTools: false`.
 */
async function bufferToolExecution(loopCtx: LoopContext, decision: ReadyDecision): Promise<BufferedExecution> {
  const gen = runToolExecution(loopCtx, decision)
  const updates: StreamChunk[] = []
  while (true) {
    const step = await gen.next()
    if (step.done) return { exec: step.value, updates }
    updates.push(step.value)
  }
}

/**
 * Emit the tool_result, message push, and `onAfterToolCall` hook for a call
 * that reached `execute()`. Shared by both paths; the caller has already
 * emitted the `tool-call` chunk and the tool's updates.
 */
async function* emitExecutionResult(
  loopCtx:     LoopContext,
  decision:    ReadyDecision,
  exec:        ToolExecutionResult,
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  const { messages, middlewares, ctx } = loopCtx
  const tc = decision.tc

  if (exec.kind === 'paused') {
    // Pause-for-client-tools propagated its calls onto `loopCtx` during
    // execution. Skip tool_result emission + message push — the call
    // stays orphaned until resume.
    return
  }

  if (exec.kind === 'error') {
    const errResult = `Error: ${exec.error.message}`
    toolResults.push({ toolCallId: tc.id, result: errResult, duration: exec.duration })
    messages.push({ role: 'tool', content: errResult, toolCallId: tc.id })
    yield { type: 'tool-result' as const, toolCall: tc, result: errResult }

    // onAfterToolCall (error case)
    if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, decision.toolArgs, errResult)
    return
  }

  // toolResults preserves the ORIGINAL value; only the message content
  // pushed onto `messages` (next-step model input) is narrowed by
  // toModelOutput. The streamed `tool-result` chunk also carries the
  // ORIGINAL value.
  toolResults.push({ toolCallId: tc.id, result: exec.result, duration: exec.duration })
  const resultStr = await applyToModelOutput(
    decision.tool,
    exec.result,
    middlewares.length > 0 ? (e) => runOnError(middlewares, ctx, e) : undefined,
  )
  messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
  yield { type: 'tool-result' as const, toolCall: tc, result: exec.result }

  // onAfterToolCall
  if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, decision.toolArgs, exec.result)
}
