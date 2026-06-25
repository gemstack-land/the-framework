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
  //
  // Handoffs always force serial dispatch — the parent loop has to halt
  // immediately on the first handoff and synthesize "skipped" results for
  // any sibling calls. Handling that across the parallel classify/replay
  // phases is doable but adds complexity for negligible benefit (the model
  // rarely emits parallel siblings alongside a handoff, and even then,
  // running them while the agent is being torn down is wasted work).
  const hasHandoff = toolCalls.some(tc => isHandoffTool(loopCtx.toolMap.get(tc.name)))
  const parallel = (options?.parallelTools ?? loopCtx.agent.parallelTools()) && toolCalls.length > 1 && !hasHandoff

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
 * Serial tool execution — the original behavior. Runs each tool call's
 * prelude (approval, before-middleware, validation) and `execute()`
 * one-after-another, streaming `tool-update` chunks live as the tool
 * emits them.
 */
async function* runToolPhaseSerial(
  loopCtx:     LoopContext,
  toolCalls:   ToolCall[],
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  const { messages, middlewares, toolMap, options, ctx } = loopCtx

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name)
    if (!tool) {
      const unknownResult = `Error: Unknown tool "${tc.name}"`
      toolResults.push({ toolCallId: tc.id, result: unknownResult })
      messages.push({ role: 'tool', content: unknownResult, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: unknownResult }
      continue
    }

    // Handoff — detected before the no-execute (client tool) branch because
    // a handoff tool also has no `execute`, but it has wholly different
    // semantics: pivot control to a new agent instead of pausing for the
    // browser. The first handoff in a step wins; any subsequent tool calls
    // in the same step are skipped with a synthetic "skipped: handed off"
    // tool result so the message log stays well-formed for replay.
    if (loopCtx.stopForHandoff) {
      const skippedResult = 'Skipped: parent agent handed off to another agent.'
      toolResults.push({ toolCallId: tc.id, result: skippedResult })
      messages.push({ role: 'tool', content: skippedResult, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: skippedResult }
      continue
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
      const handoffResult = `Handed off to ${spec.AgentClass.name}.`

      toolResults.push({ toolCallId: tc.id, result: handoffResult })
      messages.push({ role: 'tool', content: handoffResult, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: handoffResult }
      yield {
        type: 'handoff' as const,
        handoff: {
          from: loopCtx.agent.constructor.name,
          to:   spec.AgentClass.name,
          ...(transitionMessage ? { message: transitionMessage } : {}),
        },
      }

      loopCtx.pendingHandoff = { spec, transitionMessage, parentToolCallId: tc.id }
      loopCtx.stopForHandoff = true
      // Do NOT break — keep iterating so any sibling tool calls in this
      // step get their synthetic "skipped" tool results before the loop
      // exits. This preserves message-log invariants for downstream
      // persistence.
      continue
    }

    if (!tool.execute) {
      // Client tool — no server-side handler.
      if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
        loopCtx.pendingClientToolCalls.push(tc)
        loopCtx.loopFinishReason = 'client_tool_calls'
        loopCtx.stopForClientTools = true
        yield { type: 'tool-call' as const, toolCall: tc }
        continue
      }
      const placeholder = '[client tool — execute on client]'
      toolResults.push({ toolCallId: tc.id, result: placeholder })
      messages.push({ role: 'tool', content: placeholder, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: placeholder }
      continue
    }

    // needsApproval enforcement
    const approvalDecision = await evaluateApproval(tool, tc, options)
    if (approvalDecision === 'rejected') {
      const rejectionResult = { rejected: true, reason: 'User rejected this tool call' }
      toolResults.push({ toolCallId: tc.id, result: rejectionResult })
      messages.push({ role: 'tool', content: JSON.stringify(rejectionResult), toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: rejectionResult }
      continue
    }
    if (approvalDecision === 'pending') {
      loopCtx.pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
      loopCtx.loopFinishReason = 'tool_approval_required'
      loopCtx.stopForApproval = true
      yield { type: 'tool-call' as const, toolCall: tc }
      break
    }

    // onBeforeToolCall
    let toolArgs = tc.arguments
    if (middlewares.length > 0) {
      const beforeResult = await runOnBeforeToolCall(middlewares, ctx, tc.name, toolArgs)
      if (beforeResult) {
        if (beforeResult.type === 'skip') {
          const resultStr = typeof beforeResult.result === 'string' ? beforeResult.result : JSON.stringify(beforeResult.result)
          toolResults.push({ toolCallId: tc.id, result: beforeResult.result })
          messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
          yield { type: 'tool-result' as const, toolCall: tc, result: beforeResult.result }
          await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, beforeResult.result)
          continue
        }
        if (beforeResult.type === 'abort') {
          await runOnAbort(middlewares, ctx, beforeResult.reason)
          break
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
      yield { type: 'tool-call' as const, toolCall: tc }
      toolResults.push({ toolCallId: tc.id, result: validation.error })
      messages.push({ role: 'tool', content: JSON.stringify(validation.error), toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: validation.error }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, validation.error)
      continue
    }
    const validatedArgs = validation.value

    const toolStart = performance.now()
    try {
      // Emit the tool-call marker before execution so streaming UIs see
      // tool-call → tool-update* → tool-result in order. Async-generator
      // executes stream their yields as tool-update chunks live; plain
      // executes yield nothing here.
      //
      // Pause detection: a yielded `pause_for_client_tools` control chunk
      // halts iteration, propagates the nested calls to the parent's
      // pending list, and SKIPS the tool_result emission — the yielding
      // tool's own call stays orphaned in the parent message history
      // until the caller resolves it on resume.
      yield { type: 'tool-call' as const, toolCall: tc }
      const execGen = executeMaybeStreaming(tool, validatedArgs, { toolCallId: tc.id })
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
        const updateChunk: StreamChunk = { type: 'tool-update', toolCall: tc, update: step.value }
        if (middlewares.length > 0) {
          const transformed = runOnChunk(middlewares, ctx, updateChunk)
          if (transformed) yield transformed
        } else {
          yield updateChunk
        }
      }
      if (paused) continue   // skip tool_result emission + message push for this tc
      const duration = performance.now() - toolStart
      // toolResults preserves the ORIGINAL value; only the message content
      // pushed onto `messages` (next-step model input) is narrowed by
      // toModelOutput. The streamed `tool-result` chunk also carries the
      // ORIGINAL value.
      toolResults.push({ toolCallId: tc.id, result, duration })
      const resultStr = await applyToModelOutput(
        tool,
        result,
        middlewares.length > 0 ? (e) => runOnError(middlewares, ctx, e) : undefined,
      )
      messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result }

      // onAfterToolCall
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, result)
    } catch (err: unknown) {
      const duration = performance.now() - toolStart
      const msg = err instanceof Error ? err.message : String(err)
      const errResult = `Error: ${msg}`
      toolResults.push({ toolCallId: tc.id, result: errResult, duration })
      messages.push({ role: 'tool', content: errResult, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: errResult }

      // onAfterToolCall (error case)
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, errResult)
    }
  }
}

/**
 * Parallel tool execution — three phases:
 *
 * 1. **Prelude (serial, in tool-call order):** classify each call. Approval
 *    decisions, `onBeforeToolCall` middleware, and arg validation all
 *    resolve here; the next phase only sees calls that cleared every
 *    gate. `pending-approval` and `mw-abort` short-circuit the prelude
 *    exactly as they do in serial mode — later calls are never dispatched.
 *
 * 2. **Execution (parallel):** for every `ready` outcome, drive
 *    `executeMaybeStreaming` to completion concurrently. `tool-update`
 *    chunks (and any pause-for-client-tools mutations to `loopCtx`) are
 *    captured per-call into a buffer.
 *
 * 3. **Replay (serial, in tool-call order):** for each outcome, emit its
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
  const { messages, middlewares, ctx } = loopCtx

  // ─── Phase 1: prelude ──────────────────────────────────
  const outcomes = await classifyToolCalls(loopCtx, toolCalls)

  // ─── Phase 2: dispatch ready executions concurrently ──
  const ready = outcomes.filter((o): o is ReadyOutcome => o.kind === 'ready')
  const executions = await Promise.all(ready.map(o => runToolExecution(loopCtx, o)))
  const executionByCallId = new Map<string, ToolExecutionResult>()
  for (let i = 0; i < ready.length; i++) {
    executionByCallId.set(ready[i]!.tc.id, executions[i]!)
  }

  // ─── Phase 3: replay chunks + side-effects in order ───
  for (const outcome of outcomes) {
    if (outcome.kind === 'unknown-tool') {
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: outcome.result, toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      continue
    }
    if (outcome.kind === 'client-tool-stop') {
      // loopCtx mutations already applied during the prelude.
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      continue
    }
    if (outcome.kind === 'client-tool-placeholder') {
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: outcome.result, toolCallId: outcome.tc.id })
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      continue
    }
    if (outcome.kind === 'rejected') {
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: JSON.stringify(outcome.result), toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      continue
    }
    if (outcome.kind === 'pending-approval') {
      // loopCtx mutations already applied during the prelude.
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      // Phase 1 stops classifying after pending-approval, so this is the
      // last outcome — but `break` keeps the intent explicit.
      break
    }
    if (outcome.kind === 'mw-skip') {
      const resultStr = typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result)
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: resultStr, toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, outcome.result)
      continue
    }
    if (outcome.kind === 'validation-error') {
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.error })
      messages.push({ role: 'tool', content: JSON.stringify(outcome.error), toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.error }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, outcome.error)
      continue
    }
    // outcome.kind === 'ready'
    const exec = executionByCallId.get(outcome.tc.id)!
    yield { type: 'tool-call' as const, toolCall: outcome.tc }
    for (const chunk of exec.updates) yield chunk
    if (exec.kind === 'paused') {
      // Pause-for-client-tools propagated its calls onto `loopCtx` during
      // execution. Skip tool_result emission + message push — the call
      // stays orphaned until resume.
      continue
    }
    if (exec.kind === 'error') {
      const errResult = `Error: ${exec.error.message}`
      toolResults.push({ toolCallId: outcome.tc.id, result: errResult, duration: exec.duration })
      messages.push({ role: 'tool', content: errResult, toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: errResult }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, errResult)
      continue
    }
    // exec.kind === 'ok'
    toolResults.push({ toolCallId: outcome.tc.id, result: exec.result, duration: exec.duration })
    const resultStr = await applyToModelOutput(
      outcome.tool,
      exec.result,
      middlewares.length > 0 ? (e) => runOnError(middlewares, ctx, e) : undefined,
    )
    messages.push({ role: 'tool', content: resultStr, toolCallId: outcome.tc.id })
    yield { type: 'tool-result' as const, toolCall: outcome.tc, result: exec.result }
    if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, exec.result)
  }
}

// ─── Parallel-mode helpers ───────────────────────────────

type ReadyOutcome = {
  kind:          'ready'
  tc:            ToolCall
  tool:          AnyTool
  toolArgs:      Record<string, unknown>
  validatedArgs: Record<string, unknown>
}

type PreludeOutcome =
  | { kind: 'unknown-tool';             tc: ToolCall; result: string }
  | { kind: 'client-tool-placeholder';  tc: ToolCall; result: string }
  | { kind: 'client-tool-stop';         tc: ToolCall }
  | { kind: 'rejected';                 tc: ToolCall; result: { rejected: true; reason: string } }
  | { kind: 'pending-approval';         tc: ToolCall }
  | { kind: 'mw-skip';                  tc: ToolCall; toolArgs: Record<string, unknown>; result: unknown }
  | { kind: 'validation-error';         tc: ToolCall; toolArgs: Record<string, unknown>; error: InvalidToolArgumentsError }
  | ReadyOutcome

/**
 * Walk `toolCalls` in order and decide each call's fate. Mutations to
 * `loopCtx` for client-tool-stop, pending-approval, and middleware-abort
 * happen here so the rest of the parallel flow sees the same state the
 * serial path would. `pending-approval` and `mw-abort` stop the walk —
 * later calls are not classified and are silently dropped.
 */
async function classifyToolCalls(loopCtx: LoopContext, toolCalls: ToolCall[]): Promise<PreludeOutcome[]> {
  const { middlewares, toolMap, options, ctx } = loopCtx
  const outcomes: PreludeOutcome[] = []

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name)
    if (!tool) {
      outcomes.push({ kind: 'unknown-tool', tc, result: `Error: Unknown tool "${tc.name}"` })
      continue
    }
    if (!tool.execute) {
      if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
        loopCtx.pendingClientToolCalls.push(tc)
        loopCtx.loopFinishReason = 'client_tool_calls'
        loopCtx.stopForClientTools = true
        outcomes.push({ kind: 'client-tool-stop', tc })
        continue
      }
      outcomes.push({ kind: 'client-tool-placeholder', tc, result: '[client tool — execute on client]' })
      continue
    }

    const approvalDecision = await evaluateApproval(tool, tc, options)
    if (approvalDecision === 'rejected') {
      outcomes.push({ kind: 'rejected', tc, result: { rejected: true, reason: 'User rejected this tool call' } })
      continue
    }
    if (approvalDecision === 'pending') {
      loopCtx.pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
      loopCtx.loopFinishReason = 'tool_approval_required'
      loopCtx.stopForApproval = true
      outcomes.push({ kind: 'pending-approval', tc })
      break
    }

    let toolArgs = tc.arguments
    if (middlewares.length > 0) {
      const beforeResult = await runOnBeforeToolCall(middlewares, ctx, tc.name, toolArgs)
      if (beforeResult) {
        if (beforeResult.type === 'skip') {
          outcomes.push({ kind: 'mw-skip', tc, toolArgs, result: beforeResult.result })
          continue
        }
        if (beforeResult.type === 'abort') {
          await runOnAbort(middlewares, ctx, beforeResult.reason)
          // Drop any prior outcomes too? No — serial mode emits prior
          // outcomes' chunks before hitting abort, so we keep them in the
          // outcomes list and Phase 3 emits them up to (but not including)
          // this call. Stop classifying further.
          break
        }
        if (beforeResult.type === 'transformArgs') {
          toolArgs = beforeResult.args
        }
      }
    }

    const validation = validateToolArgs(tool, toolArgs)
    if (!validation.ok) {
      outcomes.push({ kind: 'validation-error', tc, toolArgs, error: validation.error })
      continue
    }

    outcomes.push({ kind: 'ready', tc, tool, toolArgs, validatedArgs: validation.value })
  }

  return outcomes
}

type ToolExecutionResult =
  | { kind: 'ok';     result: unknown; updates: StreamChunk[]; duration: number }
  | { kind: 'paused';                   updates: StreamChunk[]; duration: number }
  | { kind: 'error';  error: Error;     updates: StreamChunk[]; duration: number }

/**
 * Drive a single tool's `executeMaybeStreaming` to completion. Buffers
 * `tool-update` chunks for replay in tool-call order; pause-for-client-tools
 * mutations to `loopCtx` apply immediately and the call returns `paused`.
 *
 * `ctx` is shared across concurrent invocations. Middleware that writes
 * through `ctx` during `runOnChunk` (uncommon — most use it read-only for
 * telemetry) may observe interleaved updates from sibling tool calls;
 * apps with such middleware should opt out via `parallelTools: false`.
 */
async function runToolExecution(loopCtx: LoopContext, outcome: ReadyOutcome): Promise<ToolExecutionResult> {
  const { middlewares, ctx } = loopCtx
  const updates: StreamChunk[] = []
  const toolStart = performance.now()
  try {
    const execGen = executeMaybeStreaming(outcome.tool, outcome.validatedArgs, { toolCallId: outcome.tc.id })
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
      const updateChunk: StreamChunk = { type: 'tool-update', toolCall: outcome.tc, update: step.value }
      if (middlewares.length > 0) {
        const transformed = runOnChunk(middlewares, ctx, updateChunk)
        if (transformed) updates.push(transformed)
      } else {
        updates.push(updateChunk)
      }
    }
    const duration = performance.now() - toolStart
    if (paused) return { kind: 'paused', updates, duration }
    return { kind: 'ok', result, updates, duration }
  } catch (err) {
    const duration = performance.now() - toolStart
    return { kind: 'error', error: err instanceof Error ? err : new Error(String(err)), updates, duration }
  }
}
