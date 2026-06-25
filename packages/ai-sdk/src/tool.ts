import type { z } from 'zod'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import type {
  Tool,
  ToolCall,
  ToolCallContext,
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
} from './types.js'

// ─── Control chunks ───────────────────────────────────────

/**
 * Control chunk a server tool can `yield` from an `async function*`
 * execute to pause the enclosing agent loop and surface a set of CLIENT
 * tool calls to the caller — as if the model itself had emitted them.
 *
 * This is the sanctioned way for a server tool to inject client-tool
 * calls into the parent loop's pending list. The agent loop iterating
 * the execute generator recognizes the shape via the reserved `__rudderjs`
 * discriminator, appends `toolCalls` to the parent's
 * `pendingClientToolCalls`, sets the stop-for-client-tools flag, and —
 * critically — does NOT push an error tool_result / tool message for the
 * yielding tool call. The yielding tool's own call remains orphaned in
 * the parent's message history until the caller resolves it on
 * continuation (typically by computing a final result from whatever the
 * client-side tool execution returned).
 *
 * Why a yield instead of a throw:
 * - Symmetry with the existing `tool-update` yield protocol — no parallel
 *   catch-based control path.
 * - Middleware can observe pauses through `runOnChunk`; a thrown error
 *   would route through `onError` and muddle telemetry.
 * - Exceptions signal "something went wrong"; this is not an error.
 * - Platform-level feature: any server tool can yield this, not just
 *   nested agent runners. E.g., a tool that wants the browser's
 *   geolocation, clipboard, or a user file upload.
 *
 * **Primary use case today:** nested agent runners (`run_agent` in
 * panels). A runner that streams a sub-agent server-side can hit a pause
 * point when the sub-agent's model calls a client tool. Those calls have
 * to execute in the browser, not server-side, so the parent loop must
 * surface them to its own caller.
 *
 * Tools that yield this chunk are responsible for persisting any state
 * they need to resume the inner work on continuation (usually in a cache
 * or runStore). `@gemstack/ai-sdk` does not know or care about that state —
 * it just propagates the pause. The optional `resumeHandle` is an opaque
 * string the tool author owns; the agent loop never inspects it.
 *
 * Tool authors should construct this via {@link pauseForClientTools},
 * not by hand, so future shape changes stay source-compatible.
 */
export interface PauseForClientToolsChunk {
  /** Reserved discriminator. Namespaced to avoid colliding with user data. */
  readonly __rudderjs: 'pause_for_client_tools'
  readonly toolCalls:  ToolCall[]
  readonly resumeHandle?: string
}

/**
 * Construct a pause control chunk for `yield`ing from a server tool's
 * async-generator execute.
 *
 * @example
 * .server(async function* (input, ctx) {
 *   const subRunId = await persistSubRunState(...)
 *   yield pauseForClientTools(subAgentPending, subRunId)
 *   // Unreachable — the loop halts iteration after the pause chunk.
 *   return undefined as never
 * })
 */
export function pauseForClientTools(
  toolCalls: ToolCall[],
  resumeHandle?: string,
): PauseForClientToolsChunk {
  const chunk: PauseForClientToolsChunk = resumeHandle !== undefined
    ? { __rudderjs: 'pause_for_client_tools', toolCalls, resumeHandle }
    : { __rudderjs: 'pause_for_client_tools', toolCalls }
  return chunk
}

/**
 * Structural typeguard for a pause chunk. Used by the agent loop to
 * detect pauses mid-execute without requiring tool authors to import any
 * `@gemstack/ai-sdk` symbol at the yield site — they can yield via
 * {@link pauseForClientTools} or construct the object literal directly.
 */
export function isPauseForClientToolsChunk(value: unknown): value is PauseForClientToolsChunk {
  if (value === null || typeof value !== 'object') return false
  const v = value as { __rudderjs?: unknown; toolCalls?: unknown }
  return v.__rudderjs === 'pause_for_client_tools' && Array.isArray(v.toolCalls)
}

/**
 * Control chunk a server tool can `yield` to pause the enclosing agent
 * loop on an APPROVAL gate inside a sub-agent — the sibling of
 * {@link PauseForClientToolsChunk} for the
 * `finishReason === 'tool_approval_required'` case.
 *
 * The agent loop iterating the execute generator recognizes the shape
 * via the reserved `__rudderjs` discriminator, sets
 * `loopCtx.pendingApprovalToolCall` from `toolCall`/`isClientTool`,
 * flips `loopCtx.loopFinishReason = 'tool_approval_required'` and
 * `loopCtx.stopForApproval = true`, and SKIPS the tool_result emission
 * for the yielding tool call — the sub-agent's call stays orphaned in
 * the parent message history until the approve/reject decision arrives
 * via {@link Agent.resumeAsTool}.
 *
 * The optional `resumeHandle` (typically the `subRunId` the wrapper just
 * persisted) is opaque to the framework — tool authors own the lookup.
 *
 * **Primary use case:** a sub-agent surfaced through
 * {@link Agent.asTool} whose model invokes a `.requireApproval(true)`
 * tool. The sub-agent loop emits `pending-approval`, the wrapping
 * `asTool` generator persists a snapshot with `pauseKind: 'approval'`
 * and yields this chunk so the parent loop halts the same way it does
 * for client-tool pauses.
 *
 * Tool authors should construct this via {@link pauseForApproval}, not
 * by hand, so future shape changes stay source-compatible.
 */
export interface PauseForApprovalChunk {
  /** Reserved discriminator. Namespaced to avoid colliding with user data. */
  readonly __rudderjs: 'pause_for_approval'
  readonly toolCall:    ToolCall
  /**
   * `true` when the gated call is a client tool (no `execute` on the
   * server side); `false` for a server tool the sub-agent would have
   * run if approval had been granted.
   */
  readonly isClientTool: boolean
  readonly resumeHandle?: string
}

/**
 * Construct an approval-pause control chunk for `yield`ing from a server
 * tool's async-generator execute.
 *
 * @example
 * .server(async function* (input, ctx) {
 *   const subRunId = await persistSubRunState(...)
 *   yield pauseForApproval(innerToolCall, isClientTool, subRunId)
 *   return undefined as never
 * })
 */
export function pauseForApproval(
  toolCall:     ToolCall,
  isClientTool: boolean,
  resumeHandle?: string,
): PauseForApprovalChunk {
  const chunk: PauseForApprovalChunk = resumeHandle !== undefined
    ? { __rudderjs: 'pause_for_approval', toolCall, isClientTool, resumeHandle }
    : { __rudderjs: 'pause_for_approval', toolCall, isClientTool }
  return chunk
}

/**
 * Structural typeguard for an approval-pause chunk. Mirrors
 * {@link isPauseForClientToolsChunk} so the parent loop can recognize a
 * pause without forcing tool authors to import any `@gemstack/ai-sdk` symbol
 * at the yield site.
 */
export function isPauseForApprovalChunk(value: unknown): value is PauseForApprovalChunk {
  if (value === null || typeof value !== 'object') return false
  const v = value as { __rudderjs?: unknown; toolCall?: unknown; isClientTool?: unknown }
  return (
    v.__rudderjs === 'pause_for_approval' &&
    typeof v.toolCall === 'object' &&
    v.toolCall !== null &&
    typeof v.isClientTool === 'boolean'
  )
}

/**
 * Builder returned by {@link toolDefinition}. The builder itself is a valid
 * `Tool` — call `.server(execute)` to attach a server-side handler, or use
 * the builder as-is to register a client tool (no `execute`).
 */
export class ToolBuilder<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> implements Tool<z.infer<TInput>, never> {
  readonly options: ToolDefinitionOptions<TInput, TOutput>
  readonly definition: ToolDefinitionOptions

  /** Builders are valid client tools — `execute` is intentionally absent. */
  readonly execute?: undefined

  constructor(options: ToolDefinitionOptions<TInput, TOutput>) {
    this.options = options
    this.definition = options as unknown as ToolDefinitionOptions
  }

  /**
   * Attach a server-side handler.
   *
   * The handler may be a regular async function (single return value) or an
   * async generator (`async function*`). Generators can `yield` preliminary
   * progress payloads — each yield surfaces as a `tool-update` stream chunk
   * while the tool runs. The generator's `return` value becomes the final
   * tool result. The same tool definition works in both `agent.prompt()`
   * (yields are silently drained) and `agent.stream()`.
   */
  // The generator overload MUST come first. If the plain-async overload is
  // tried first, TypeScript happily binds `TReturn = AsyncGenerator<...>` for
  // an `async function*`, which then leaks the generator type into chained
  // refinements like `.modelOutput(result => ...)`. Generators have a
  // structural protocol (`.next` / `.return` / `[Symbol.asyncIterator]`) that
  // doesn't match `Promise<T>`, so non-generator executes still resolve
  // cleanly to the second overload.
  server<TReturn = unknown, TUpdate = unknown>(
    execute: (input: z.infer<TInput>, ctx?: ToolCallContext) => AsyncGenerator<TUpdate, TReturn, void>,
  ): ServerToolBuilder<z.infer<TInput>, TReturn>
  server<TReturn = unknown>(
    execute: (input: z.infer<TInput>, ctx?: ToolCallContext) => TReturn | Promise<TReturn>,
  ): ServerToolBuilder<z.infer<TInput>, TReturn>
  server<TReturn = unknown>(
    execute: ToolExecuteFn<z.infer<TInput>, TReturn, unknown>,
  ): ServerToolBuilder<z.infer<TInput>, TReturn> {
    return new ServerToolBuilder<z.infer<TInput>, TReturn>(
      this.options as unknown as ToolDefinitionOptions,
      execute as ToolExecuteFn<z.infer<TInput>, TReturn, unknown>,
    )
  }

  /** Convert to provider-friendly JSON Schema format */
  toSchema(): ToolDefinitionSchema {
    const schema: ToolDefinitionSchema = {
      name: this.options.name,
      description: this.options.description,
      parameters: this.options.jsonSchema ?? zodToJsonSchema(this.options.inputSchema, 'input'),
    }
    if (this.options.providerHint) schema.providerHint = this.options.providerHint
    return schema
  }
}

/**
 * Builder returned by {@link ToolBuilder.server}. Itself a valid `Tool`, so
 * it can be passed directly into `tools()` arrays — `.toModelOutput(...)` is
 * an optional chained refinement, not a required `.build()` step.
 *
 * Future per-tool refinements (`.onError(...)`, `.middleware(...)`) would slot
 * in here in the same chained-builder style.
 */
export class ServerToolBuilder<TInput = unknown, TOutput = unknown>
  implements Tool<TInput, TOutput>
{
  readonly definition: ToolDefinitionOptions
  readonly execute: ToolExecuteFn<TInput, TOutput, unknown>
  readonly toModelOutput?: ((result: TOutput) => string | Promise<string>) | undefined

  constructor(
    definition: ToolDefinitionOptions,
    execute: ToolExecuteFn<TInput, TOutput, unknown>,
    toModelOutput?: (result: TOutput) => string | Promise<string>,
  ) {
    this.definition = definition
    this.execute = execute
    if (toModelOutput) this.toModelOutput = toModelOutput
  }

  /**
   * Declare a transform from this tool's structured result to the string the
   * **model** sees on its next step. The UI continues to receive the original
   * structured result.
   *
   * @example
   * toolDefinition({...})
   *   .server(async (input) => bigStructuredResult)
   *   .modelOutput((result) => `${result.items.length} items found`)
   */
  modelOutput(
    fn: (result: TOutput) => string | Promise<string>,
  ): ServerToolBuilder<TInput, TOutput> {
    return new ServerToolBuilder<TInput, TOutput>(this.definition, this.execute, fn)
  }
}

/**
 * Define a tool with typed input/output schemas.
 *
 * @example  Server tool
 * const weatherTool = toolDefinition({
 *   name: 'get_weather',
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({ location: z.string() }),
 * }).server(async ({ location }) => ({ temp: 72, unit: 'F' }))
 *
 * @example  Client tool (no `.server()`)
 * const readFormStateTool = toolDefinition({
 *   name: 'read_form_state',
 *   description: 'Read the user\'s current local form values.',
 *   inputSchema: z.object({ fields: z.array(z.string()).optional() }),
 * })
 */
export function toolDefinition<
  TInput extends z.ZodType,
  TOutput extends z.ZodType = z.ZodUndefined,
>(options: ToolDefinitionOptions<TInput, TOutput>): ToolBuilder<TInput, TOutput> {
  return new ToolBuilder(options)
}

/**
 * Build a tool whose input/output types are not known at compile time.
 *
 * Use this when the tool's schema is constructed dynamically from user data
 * (e.g. a resource agent that exposes one tool per agent definition).
 *
 * @example
 * const t = dynamicTool({
 *   name: agentDef.slug,
 *   description: agentDef.description,
 *   inputSchema: z.object({}),
 * }).server(async () => agentDef.run())
 */
export function dynamicTool(
  options: ToolDefinitionOptions,
): ToolBuilder {
  return new ToolBuilder(options as ToolDefinitionOptions<z.ZodType, z.ZodType>)
}

/** Convert any Tool to a ToolDefinitionSchema for provider consumption */
export function toolToSchema(tool: { definition: ToolDefinitionOptions }): ToolDefinitionSchema {
  const schema: ToolDefinitionSchema = {
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: tool.definition.jsonSchema ?? zodToJsonSchema(tool.definition.inputSchema, 'input'),
  }
  // Propagate provider-specific hints so adapters that recognize the
  // `providerHint.type` can substitute their native tool block (see
  // `toAnthropicTools` for computer-use, `toOpenAITools` for file-search).
  if (tool.definition.providerHint) schema.providerHint = tool.definition.providerHint
  return schema
}
