import type {
  AiMiddleware,
  BeforeToolCallResult,
  MiddlewareConfigResult,
  MiddlewareContext,
  StreamChunk,
  TokenUsage,
} from './types.js'

/** Run onConfig hooks — piped (each transforms config, next sees result) */
export function runOnConfig(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  config: MiddlewareConfigResult,
  phase: 'init' | 'beforeModel',
): MiddlewareConfigResult {
  let result = config
  for (const mw of middlewares) {
    if (mw.onConfig) {
      const transformed = mw.onConfig(ctx, result, phase)
      if (transformed) result = transformed
    }
  }
  return result
}

/** Run onChunk hooks — piped (each can transform or drop by returning null) */
export function runOnChunk(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  chunk: StreamChunk,
): StreamChunk | null {
  let result: StreamChunk | null = chunk
  for (const mw of middlewares) {
    if (result === null) break
    if (mw.onChunk) {
      result = mw.onChunk(ctx, result)
    }
  }
  return result
}

/** Run onBeforeToolCall hooks — first non-void result wins */
export async function runOnBeforeToolCall(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<BeforeToolCallResult> {
  for (const mw of middlewares) {
    if (mw.onBeforeToolCall) {
      const result = await mw.onBeforeToolCall(ctx, toolName, args)
      if (result !== undefined && result !== null) return result
    }
  }
  return undefined
}

/** Run a sequential hook (onStart, onIteration, onAfterToolCall, etc.) */
export async function runSequential(
  middlewares: AiMiddleware[],
  hook: 'onStart' | 'onIteration' | 'onToolPhaseComplete' | 'onFinish',
  ctx: MiddlewareContext,
): Promise<void> {
  for (const mw of middlewares) {
    const fn = mw[hook]
    if (fn) await fn.call(mw, ctx)
  }
}

/** Run onAfterToolCall hooks sequentially */
export async function runOnAfterToolCall(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  for (const mw of middlewares) {
    if (mw.onAfterToolCall) await mw.onAfterToolCall(ctx, toolName, args, result)
  }
}

/** Run onUsage hooks sequentially */
export async function runOnUsage(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  usage: TokenUsage,
): Promise<void> {
  for (const mw of middlewares) {
    if (mw.onUsage) await mw.onUsage(ctx, usage)
  }
}

/** Run onAbort hooks sequentially */
export async function runOnAbort(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  reason: string,
): Promise<void> {
  for (const mw of middlewares) {
    if (mw.onAbort) await mw.onAbort(ctx, reason)
  }
}

/** Run onError hooks sequentially */
export async function runOnError(
  middlewares: AiMiddleware[],
  ctx: MiddlewareContext,
  error: unknown,
): Promise<void> {
  for (const mw of middlewares) {
    if (mw.onError) await mw.onError(ctx, error)
  }
}
