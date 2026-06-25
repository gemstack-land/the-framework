import type { AgentPromptOptions, Tool, ToolCall, ToolCallContext } from './types.js'

/**
 * Detect an async generator (the value returned by `async function*` or any
 * object implementing the AsyncGenerator protocol). We use a structural check
 * because the executor may not be authored as a literal `async function*`
 * (e.g. wrapped or returned from a factory).
 */
export function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, void> {
  if (value === null || typeof value !== 'object') return false
  const v = value as { next?: unknown; return?: unknown; [Symbol.asyncIterator]?: unknown }
  return typeof v.next === 'function'
    && typeof v.return === 'function'
    && typeof v[Symbol.asyncIterator] === 'function'
}

/**
 * Uniformly iterate a tool's `execute`, whether it returns a value, a
 * promise, or an async generator.
 *
 * The helper is itself an async generator: each `yield` is a preliminary
 * tool-update payload (only generator-style executes produce these), and the
 * generator's `return` value is the final tool result.
 *
 * Streaming callers iterate and emit `tool-update` chunks live as updates
 * arrive. Non-streaming callers iterate and discard yields, capturing only
 * the final return value — same tool definition works in both modes.
 */
export async function* executeMaybeStreaming(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): AsyncGenerator<unknown, unknown, void> {
  const execute = tool.execute as
    | ((input: unknown, ctx?: ToolCallContext) => unknown)
    | undefined
  if (!execute) {
    throw new Error('Tool has no execute function')
  }
  const ret = execute(args, ctx)
  if (isAsyncGenerator(ret)) {
    while (true) {
      const step = await ret.next()
      if (step.done) return step.value
      yield step.value
    }
  }
  return await ret
}

/**
 * Structured error returned to the model when a tool call's arguments fail
 * the tool's `inputSchema`. Surfaced both as the `result` on `AgentStep`
 * and as the JSON-encoded `tool` message the next provider step receives,
 * so the model can correct itself on the next turn.
 */
export interface InvalidToolArgumentsError {
  error: 'invalid_arguments'
  message: string
  issues: Array<{ path: string; message: string }>
}

/**
 * Validate a tool call's arguments against the tool's `inputSchema`. On
 * success, the parsed value is returned — zod transforms (`.transform`,
 * `.default`, type coercion) are applied, so `execute` receives the
 * canonical shape the schema describes. On failure, a structured error
 * suitable for feeding back to the model is returned.
 */
export function validateToolArgs(
  tool: Tool,
  args: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: InvalidToolArgumentsError } {
  const parsed = tool.definition.inputSchema.safeParse(args)
  if (parsed.success) {
    return { ok: true, value: parsed.data as Record<string, unknown> }
  }
  return {
    ok: false,
    error: {
      error: 'invalid_arguments',
      message: `Tool "${tool.definition.name}" received arguments that did not match its inputSchema.`,
      issues: parsed.error.issues.map(i => ({
        path: i.path.map(seg => String(seg)).join('.'),
        message: i.message,
      })),
    },
  }
}

/**
 * Default stringification used for the `tool` role message content when a
 * tool has no `toModelOutput` transform: pass through strings, JSON-encode
 * everything else.
 */
export function defaultStringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Convert a tool's structured `result` into the string the **model** will
 * see on its next step. Honors `tool.toModelOutput` when present, falling
 * back to {@link defaultStringify}.
 *
 * Per R6 in the ai-loop-parity plan: a throwing `toModelOutput` MUST NOT
 * crash the loop. We swallow the error, route it through `onError`
 * middleware so it stays observable, and use the default stringification
 * as a safety net.
 */
export async function applyToModelOutput(
  tool: Tool,
  result: unknown,
  onError?: (err: unknown) => void | Promise<void>,
): Promise<string> {
  if (tool.toModelOutput) {
    try {
      return await (tool.toModelOutput as (r: unknown) => string | Promise<string>)(result)
    } catch (err) {
      if (onError) await onError(err)
    }
  }
  return defaultStringify(result)
}

/**
 * Resolve `needsApproval` for a tool call, taking into account the
 * client-supplied `approvedToolCallIds` / `rejectedToolCallIds` lists.
 *
 * Returns:
 * - `'allow'`     — execute the tool normally (default; also when approved)
 * - `'pending'`   — needsApproval is truthy and the call has not been approved
 * - `'rejected'`  — the call appears in `rejectedToolCallIds`
 */
export async function evaluateApproval(
  tool: Tool,
  tc: ToolCall,
  options: AgentPromptOptions | undefined,
): Promise<'allow' | 'pending' | 'rejected'> {
  const needs = tool.definition.needsApproval
  const requires = typeof needs === 'function' ? await needs(tc.arguments) : !!needs
  if (!requires) return 'allow'

  if (options?.rejectedToolCallIds?.includes(tc.id)) return 'rejected'
  if (options?.approvedToolCallIds?.includes(tc.id)) return 'allow'
  return 'pending'
}
