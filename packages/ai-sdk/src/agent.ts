import { z } from 'zod'
import { AiRegistry } from './registry.js'
import { pauseForApproval, pauseForClientTools, toolDefinition, toolToSchema } from './tool.js'
import type { PauseForApprovalChunk, PauseForClientToolsChunk, ServerToolBuilder } from './tool.js'
import type { HandoffSpec } from './handoff.js'
import { attachmentsToContentParts, getMessageText } from './attachment.js'
import { QueuedPromptBuilder } from './queue-job.js'
import {
  resolveAutoPersistSpec,
  runWithPersistence,
  runWithPersistenceStreaming,
} from './conversation-persistence.js'
import { resolveRemembersSpec } from './memory.js'
import { withMemoryInject } from './memory-inject.js'
import { withMemoryExtract } from './memory-extract.js'
import type { SubAgentPauseKind, SubAgentRunSnapshot, SubAgentRunStore } from './sub-agent-run-store.js'
import {
  runOnConfig,
  runOnChunk,
  runSequential,
  runOnUsage,
  runOnAbort,
  runOnError,
} from './middleware.js'
import type { AiObserverRegistry, AiEvent, AiObserverStep } from './observers.js'
import type { InvalidToolArgumentsError } from './tool-helpers.js'
import { executeToolPhase } from './tool-execution.js'
import { resumePendingToolCalls } from './resume-approval.js'
import {
  buildHandoffChildOptions,
  driveHandoffs,
  MAX_HANDOFFS,
  mergeFinalHandoff,
  stripInternal,
} from './handoffs-driver.js'
import type { PendingHandoff } from './handoffs-driver.js'
import type {
  AgentPromptOptions,
  AiMessage,
  AiMiddleware,
  Attachment,
  AgentResponse,
  AgentStep,
  AgentStreamResponse,
  AnyTool,
  CacheableConfig,
  CacheableMarkers,
  ContentPart,
  ConversationalOverride,
  ConversationalSpec,
  ConversationStore,
  SubAgentUpdate,
  FinishReason,
  HasMiddleware,
  HasTools,
  MiddlewareContext,
  PrepareStepResult,
  ProviderRequestOptions,
  RemembersSpec,
  StopCondition,
  StreamChunk,
  Tool,
  ToolCall,
  ToolCallContext,
  ToolResult,
  TokenUsage,
  ToolChoice,
  UserMemory,
} from './types.js'

// ─── AI Observer (lazy accessor) ─────────────────────────

function _getAiObservers(): AiObserverRegistry | null {
  return ((globalThis as Record<string, unknown>)['__rudderjs_ai_observers__'] as AiObserverRegistry | undefined) ?? null
}

function _buildObserverSteps(steps: AgentStep[], modelString: string): AiObserverStep[] {
  return steps.map((step, i) => ({
    iteration:    i + 1,
    model:        modelString,
    tokens:       { prompt: step.usage.promptTokens, completion: step.usage.completionTokens, total: step.usage.totalTokens },
    finishReason: step.finishReason,
    toolCalls:    step.toolCalls.map(tc => {
      const tr = step.toolResults.find(r => r.toolCallId === tc.id)
      return {
        id:            tc.id,
        name:          tc.name,
        args:          tc.arguments,
        result:        tr?.result,
        duration:      tr?.duration ?? 0,
        needsApproval: false,
      }
    }),
  }))
}

// ─── Stop Condition Combinators ──────────────────────────

/** Stop after N steps */
export function stepCountIs(n: number): StopCondition {
  return ({ steps }) => steps.length >= n
}

/** Stop when a specific tool is called in the latest step */
export function hasToolCall(toolName: string): StopCondition {
  return ({ steps }) => {
    const last = steps[steps.length - 1]
    return last?.toolCalls.some(tc => tc.name === toolName) ?? false
  }
}

// ─── Singular sub-agent resume (resumeAsTool) ────────────

/** Options for {@link Agent.resumeAsTool}. */
export interface SubAgentResumeOptions {
  /** Shared run store the snapshot lives in. */
  runStore:             SubAgentRunStore
  /** The sub-agent instance to resume. */
  agent:                Agent
  /** Approved ids for an `approval` pause. */
  approvedToolCallIds?: string[]
  /** Rejected ids for an `approval` pause. */
  rejectedToolCallIds?: string[]
  /**
   * Opt-in live progress during the resume. When set, the resumed inner loop
   * runs via `stream()` instead of `prompt()` and each chunk is projected into
   * a {@link SubAgentUpdate} forwarded to {@link onUpdate}. `true` uses
   * {@link defaultSubAgentProjector} (emits `tool_call` / `agent_pending_approval`);
   * a function is your own projector. Mirrors {@link Agent.asTool}'s `streaming`
   * on the initial-dispatch path. Unset → the legacy non-streaming `prompt()`
   * resume (no behavior change). The pause/completion partition is identical
   * either way — this only adds a progress channel.
   */
  streaming?:           AsToolStreamingOption
  /**
   * Sink for projected updates. Only fires when {@link streaming} is set, once
   * per non-null projection, in stream order. Awaited, so a slow sink applies
   * backpressure to the resume.
   */
  onUpdate?:            (update: SubAgentUpdate) => void | Promise<void>
  /**
   * Opaque correlation key for the streaming projector's `ctx` 2nd arg. Set
   * internally by {@link Agent.resumeManyAsTool} from each request's `key` so a
   * batch host's projector can route a raw {@link StreamChunk} to the right
   * per-sub-agent channel. Not part of the public singular call surface.
   * @internal
   */
  key?:                 string
}

// ─── Batch sub-agent resume (resumeManyAsTool) ───────────

/**
 * One entry in a {@link Agent.resumeManyAsTool} batch — a single paused
 * sub-agent to resume. Mirrors the positional args of the singular
 * {@link Agent.resumeAsTool}, plus an optional host `key` echoed back on the
 * matching outcome so callers can correlate results without relying on array
 * order.
 */
export interface SubAgentResumeRequest {
  /** The paused run's id (the `subRunId` from its pause chunk/snapshot). */
  subRunId:             string
  /** The sub-agent instance to resume (each item may be a different agent). */
  agent:                Agent
  /** Client tool-results for a `client_tool` pause (one per pending id). */
  clientToolResults?:   ReadonlyArray<{ toolCallId: string; result: unknown }>
  /** Approved ids for an `approval` pause. */
  approvedToolCallIds?: string[]
  /** Rejected ids for an `approval` pause. */
  rejectedToolCallIds?: string[]
  /** Opaque correlation key echoed back on this item's outcome. */
  key?:                 string
}

/** Outcome for a single item in a {@link Agent.resumeManyAsTool} batch. */
export type SubAgentResumeOutcome =
  | { key?: string; originalSubRunId: string; kind: 'completed'; response: AgentResponse }
  | {
      key?:               string
      originalSubRunId:   string
      kind:               'paused'
      subRunId:           string
      pauseKind:          SubAgentPauseKind
      pendingToolCallIds: string[]
      toolCall?:          ToolCall
      isClientTool?:      boolean
    }
  | { key?: string; originalSubRunId: string; kind: 'error'; error: Error }

export interface SubAgentResumeManyOptions {
  /** Shared run store all the snapshots live in. */
  runStore:     SubAgentRunStore
  /**
   * What to do when one item fails (expired/forged `subRunId`, duplicate
   * result id, inner error):
   * - `'capture'` (default) — record it as a `{ kind: 'error' }` outcome and
   *   let the rest of the batch resume; the aggregated round-trip still
   *   returns.
   * - `'throw'` — reject the whole call on the first failure, matching the
   *   singular `resumeAsTool` strictness.
   */
  onError?:     'capture' | 'throw'
  /**
   * - `'parallel'` (default) — resume all snapshots concurrently. Snapshots
   *   are independent and `consume()` is per-id atomic, so this is safe and
   *   fastest.
   * - `'serial'` — resume one at a time in array order, for deterministic
   *   side-effect ordering when sub-agents touch shared state.
   */
  concurrency?: 'parallel' | 'serial'
  /**
   * Shared live-progress projector applied to every resumed item — same option
   * as {@link SubAgentResumeOptions.streaming}. Unset → every item resumes
   * non-streaming (legacy behavior). Set → each item streams and its projected
   * updates flow to {@link onUpdate} tagged with the originating request.
   */
  streaming?:   AsToolStreamingOption
  /**
   * Sink for projected updates across the whole batch. Only fires when
   * {@link streaming} is set. Each call carries the originating item's `key`
   * (when supplied) and `originalSubRunId`, so a host can correlate a chunk
   * back to its request and fan it out (e.g. to a per-sub-agent SSE channel).
   */
  onUpdate?:    (update: SubAgentUpdate, ctx: { key?: string; originalSubRunId: string }) => void | Promise<void>
}

/** Aggregated result of a {@link Agent.resumeManyAsTool} batch. */
export interface SubAgentResumeManyResult {
  /** Every item's outcome, in input order. */
  results:            SubAgentResumeOutcome[]
  /** The items that paused again (need another client round-trip). */
  paused:             Extract<SubAgentResumeOutcome, { kind: 'paused' }>[]
  /** The items that ran to completion. */
  completed:          Extract<SubAgentResumeOutcome, { kind: 'completed' }>[]
  /** The items that failed (only populated under `onError: 'capture'`). */
  errors:             Extract<SubAgentResumeOutcome, { kind: 'error' }>[]
  /**
   * All pending tool-call ids across every paused item, flattened — the
   * single set the host gathers client results / approvals for before the
   * next `resumeManyAsTool`. Empty when nothing paused.
   */
  pendingToolCallIds: string[]
  /**
   * `true` when nothing is still paused and no item errored — i.e. there is
   * no further round-trip to do. Loop `resumeManyAsTool` until this is `true`.
   */
  allCompleted:       boolean
}

// ─── Agent Base Class ────────────────────────────────────

export abstract class Agent {
  /** System instructions for this agent */
  abstract instructions(): string

  /** Model string (e.g. 'anthropic/claude-sonnet-4-5'). Defaults to registry default. */
  model(): string | undefined { return undefined }

  /** Failover provider/model strings */
  failover(): string[] { return [] }

  /** Maximum iterations for the tool loop (default: 20) */
  maxSteps(): number { return 20 }

  /** Per-step control — override model, tools, messages per iteration */
  prepareStep?(_ctx: { stepNumber: number; steps: AgentStep[]; messages: AiMessage[] }): PrepareStepResult | Promise<PrepareStepResult>

  /** Stop conditions — combine with array (OR logic) */
  stopWhen(): StopCondition | StopCondition[] {
    return stepCountIs(this.maxSteps())
  }

  /** Temperature (0-1) */
  temperature(): number | undefined { return undefined }

  /** Max tokens for response */
  maxTokens(): number | undefined { return undefined }

  /**
   * Declarative prompt-cache configuration.
   *
   * Override on a subclass to mark stable parts of the prompt as cacheable
   * — provider adapters translate to native primitives (Anthropic
   * `cache_control`, OpenAI `prompt_cache_key`, Google `cachedContent`)
   * so cache hits can save 50–90% on input tokens for long system prompts,
   * tool definitions, or stable conversation context.
   *
   * Returning `undefined` (the default) means no caching. Per-call override
   * via `agent.prompt(input, { cache: false })` disables caching for that
   * call; passing a {@link CacheableConfig} for `cache` replaces the agent
   * default for that call.
   *
   * @example
   * class SupportAgent extends Agent {
   *   instructions() { return LONG_SYSTEM_PROMPT }
   *   tools()        { return [tool1, tool2, tool3] }
   *   cacheable() {
   *     return { instructions: true, tools: true }
   *   }
   * }
   */
  cacheable(): CacheableConfig | undefined { return undefined }

  /**
   * Opt into auto-persisted conversation behavior. Override on a subclass
   * to declare *which* user owns the thread and (optionally) which
   * specific thread, and the framework will load history before each
   * `prompt()`/`stream()` call and append the new turn after it — without
   * any caller having to remember `forUser()` / `continue()`.
   *
   * Returning `false` (the default) disables auto-persist; the agent runs
   * stateless. Returning a {@link ConversationalSpec} opts in:
   *
   * @example
   * class ChatAgent extends Agent {
   *   conversational() {
   *     return { user: Auth.user()?.id }   // null user → falsy → opt-out
   *   }
   * }
   *
   * await new ChatAgent().prompt('Hi')          // auto-loads + auto-saves
   *
   * **Precedence (high → low):**
   * 1. Explicit `agent.forUser(id).prompt()` / `agent.continue(id).prompt()`
   * 2. Per-call `prompt(input, { conversation: false | {...} })`
   * 3. This method's return value
   *
   * Async returns are supported — useful when the user identity is fetched
   * from an async DI binding.
   */
  conversational(): false | ConversationalSpec | Promise<false | ConversationalSpec> {
    return false
  }

  /**
   * Opt this agent class into per-user memory beyond conversation history
   * (#A4). Returns a {@link RemembersSpec} naming the user whose memory
   * the agent reads/writes, and how injection / extraction should behave.
   * Returning `false` (the default) leaves the agent memory-stateless.
   *
   * Phase 1 wires the declaration + the per-call precedence chain so
   * apps and downstream phases (auto-inject middleware in Phase 2,
   * auto-extract middleware in Phase 3) can read a consistent spec.
   * Calling this method directly today produces no runtime behavior
   * unless application code reads it via `resolveRemembersSpec()`.
   *
   * **Precedence (high → low):**
   * 1. Per-call `prompt(input, { memory: false | {...} })`
   * 2. This method's return value
   *
   * Async returns are supported — useful when the user identity is fetched
   * from an async DI binding.
   *
   * @example
   * class SupportAgent extends Agent {
   *   remembers() { return { user: ctx.user.id, inject: 'auto', tags: ['support'] } }
   * }
   */
  remembers(): false | RemembersSpec | Promise<false | RemembersSpec> {
    return false
  }

  /**
   * Default for `AgentPromptOptions.parallelTools`. When `true` (default),
   * multiple tool calls within a single step run their `execute()` functions
   * concurrently. Override on a subclass to flip the default for an agent
   * whose tools share non-idempotent state. Per-call options still win.
   */
  parallelTools(): boolean { return true }

  /** Run the agent with a prompt (non-streaming) */
  async prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
    // Memory auto-cascade — appends inject (Phase 2) + extract (Phase 3)
    // middlewares when `Agent.remembers()` opts in. Runs BEFORE
    // conversation persistence so the persisted history flows in
    // unchanged: inject only grows the system message; extract only
    // fires onFinish.
    const effOptions = await prepareOptionsWithMemoryAutoCascade(this, options)

    const spec = await resolveAutoPersistSpec(() => this.conversational(), effOptions?.conversation)
    if (spec) {
      return runWithPersistence(
        spec,
        this.constructor.name,
        resolveConversationStore,
        input,
        effOptions,
        (innerOptions) => runAgentLoop(this, input, innerOptions),
      )
    }
    return runAgentLoop(this, input, effOptions)
  }

  /** Run the agent with a prompt (streaming) */
  stream(input: string, options?: AgentPromptOptions): AgentStreamResponse {
    return runStreamWithMaybeAutoPersist(this, input, options)
  }

  /** Queue the prompt for background execution */
  queue(input: string, options?: AgentPromptOptions): QueuedPromptBuilder {
    return new QueuedPromptBuilder(this, input, options)
  }

  /** Set the user scope for conversation persistence */
  forUser(userId: string): ConversableAgent {
    return new ConversableAgent(this).forUser(userId)
  }

  /** Continue an existing conversation */
  continue(conversationId: string): ConversableAgent {
    return new ConversableAgent(this).continue(conversationId)
  }

  /**
   * Wrap this agent as a tool another agent can call (the "subagents"
   * pattern). The returned tool is fully-formed — pass it directly into the
   * parent agent's `tools()` array. When the parent calls it, this agent
   * runs its own loop end-to-end (its own model, tools, middleware) and
   * returns a single result.
   *
   * Defaults are tuned for the zero-config case:
   * - `inputSchema` defaults to `{ prompt: string }` and the agent is
   *   invoked with `input.prompt`.
   * - The parent model only sees `response.text` on its next step
   *   (override with `modelOutput`); the UI still receives the full
   *   `AgentResponse` via the `tool-result` chunk.
   *
   * @example  Zero-config
   * const research = researchAgent.asTool({
   *   name: 'research',
   *   description: 'Research a topic in depth.',
   * })
   *
   * @example  Custom schema + prompt mapper
   * const research = researchAgent.asTool({
   *   name: 'research',
   *   description: 'Research a topic in depth.',
   *   inputSchema: z.object({ topic: z.string(), depth: z.enum(['quick', 'deep']) }),
   *   prompt:      ({ topic, depth }) => `Research ${topic} (${depth}).`,
   * })
   */
  asTool<TInput extends z.ZodType>(options: {
    name:         string
    description:  string
    inputSchema:  TInput
    prompt:       (input: z.infer<TInput>) => string
    modelOutput?: (response: AgentResponse) => string | Promise<string>
    streaming?:   AsToolStreamingOption
    suspendable?: AsToolSuspendableOption
  }): ServerToolBuilder<z.infer<TInput>, AgentResponse>
  asTool(options: {
    name:         string
    description:  string
    modelOutput?: (response: AgentResponse) => string | Promise<string>
    streaming?:   AsToolStreamingOption
    suspendable?: AsToolSuspendableOption
  }): ServerToolBuilder<{ prompt: string }, AgentResponse>
  asTool(options: {
    name:         string
    description:  string
    inputSchema?: z.ZodType
    prompt?:      (input: unknown) => string
    modelOutput?: (response: AgentResponse) => string | Promise<string>
    streaming?:   AsToolStreamingOption
    suspendable?: AsToolSuspendableOption
  }): ServerToolBuilder<unknown, AgentResponse> {
    if (options.suspendable && !options.streaming) {
      throw new Error('[ai-sdk] asTool: `suspendable` requires `streaming: true` (or a projector). Silent suspend would leave the parent UI with no progress signal between sub-agent invocations.')
    }

    const schema      = options.inputSchema ?? z.object({ prompt: z.string() })
    const promptOf    = options.prompt      ?? ((input: unknown) => (input as { prompt: string }).prompt)
    const modelOutput = options.modelOutput ?? ((response: AgentResponse) => response.text)

    if (!options.streaming) {
      // 1.2.0 zero-config path — single prompt() call, single AgentResponse out.
      return toolDefinition({
        name:        options.name,
        description: options.description,
        inputSchema: schema,
      })
        .server((input: unknown): Promise<AgentResponse> => this.prompt(promptOf(input)))
        .modelOutput(modelOutput)
    }

    const project: ChunkProjector = options.streaming === true ? defaultSubAgentProjector : options.streaming
    const innerAgent = this // eslint-disable-line @typescript-eslint/no-this-alias
    const agentName  = options.name
    const suspendable = options.suspendable

    const generatorExecute = async function* (
      input: unknown,
    ): AsyncGenerator<SubAgentUpdate | PauseForClientToolsChunk | PauseForApprovalChunk, AgentResponse, void> {
      const userPrompt = promptOf(input)

      yield { kind: 'agent_start', agentName }

      const streamOpts = suspendable
        ? { toolCallStreamingMode: 'stop-on-client-tool' as const }
        : undefined
      const { stream, response } = innerAgent.stream(userPrompt, streamOpts)

      for await (const chunk of stream) {
        const update = project(chunk)
        if (update) yield update
      }

      const result = await response

      if (
        suspendable &&
        result.finishReason === 'client_tool_calls' &&
        result.pendingClientToolCalls?.length
      ) {
        const subRunId = generateSubRunId()
        const snapshot: SubAgentRunSnapshot = {
          messages:           buildSubAgentSnapshotMessages(userPrompt, result),
          pendingToolCallIds: result.pendingClientToolCalls.map((tc) => tc.id),
          stepsSoFar:         result.steps.length,
          tokensSoFar:        result.usage?.totalTokens ?? 0,
          pauseKind:          'client_tool',
        }
        await suspendable.runStore.store(subRunId, snapshot)

        yield { kind: 'subagent_paused', subRunId, pendingToolCallIds: snapshot.pendingToolCallIds }
        yield pauseForClientTools(result.pendingClientToolCalls, subRunId)
        // Unreachable — the parent loop halts iteration after the pause chunk.
        return undefined as never
      }

      if (
        suspendable &&
        result.finishReason === 'tool_approval_required' &&
        result.pendingApprovalToolCall
      ) {
        const subRunId = generateSubRunId()
        const { toolCall: pendingCall, isClientTool } = result.pendingApprovalToolCall
        const snapshot: SubAgentRunSnapshot = {
          messages:                buildSubAgentSnapshotMessages(userPrompt, result),
          pendingToolCallIds:      [pendingCall.id],
          stepsSoFar:              result.steps.length,
          tokensSoFar:             result.usage?.totalTokens ?? 0,
          pauseKind:               'approval',
          pendingApprovalToolCall: { toolCall: pendingCall, isClientTool },
        }
        await suspendable.runStore.store(subRunId, snapshot)

        yield {
          kind:         'subagent_paused_approval',
          subRunId,
          toolCall:     pendingCall,
          isClientTool,
        }
        yield pauseForApproval(pendingCall, isClientTool, subRunId)
        // Unreachable — the parent loop halts iteration after the pause chunk.
        return undefined as never
      }

      yield {
        kind:   'agent_done',
        steps:  result.steps.length,
        tokens: result.usage?.totalTokens ?? 0,
      }
      return result
    }

    return toolDefinition({
      name:        options.name,
      description: options.description,
      inputSchema: schema,
    })
      .server(generatorExecute)
      .modelOutput(modelOutput) as unknown as ServerToolBuilder<unknown, AgentResponse>
  }

  /**
   * Resume a sub-agent run that previously paused with either
   * `pauseForClientTools` (client-tool pause) or `pauseForApproval`
   * (approval pause), typically from {@link Agent.asTool} with
   * `suspendable: { runStore }` set. The snapshot's `pauseKind`
   * (default `'client_tool'`) selects the resume contract:
   *
   * - **`client_tool`** — `clientToolResults` must carry one entry per
   *   id in the snapshot's `pendingToolCallIds`. Results are appended
   *   to the inner-agent message history and the loop re-runs.
   * - **`approval`** — `approvedToolCallIds` and/or
   *   `rejectedToolCallIds` must reference the single pending id.
   *   `clientToolResults` must be empty; the loop re-runs with the
   *   approval decision injected via `AgentPromptOptions`.
   *
   * Returns either a `'completed'` result (the inner agent finished),
   * a `'paused'` continuation pointing at a fresh `subRunId` for the
   * next round-trip, or stays `'paused'` if the inner loop hits another
   * gate. The resume can pause on a different kind than it started on
   * (e.g. an approval pause that, once approved, hits a client-tool
   * pause on the next step).
   *
   * @example  Client-tool resume
   * const r = await Agent.resumeAsTool(subRunId, browserResults, { runStore, agent: subAgent })
   *
   * @example  Approval resume
   * const r = await Agent.resumeAsTool(subRunId, [], {
   *   runStore, agent: subAgent,
   *   approvedToolCallIds: ['inner-call-id'],
   * })
   */
  static async resumeAsTool(
    subRunId:          string,
    clientToolResults: ReadonlyArray<{ toolCallId: string; result: unknown }>,
    options:           SubAgentResumeOptions,
  ): Promise<
    | { kind: 'completed'; response: AgentResponse }
    | {
        kind:               'paused'
        subRunId:           string
        pauseKind:          SubAgentPauseKind
        pendingToolCallIds: string[]
        toolCall?:          ToolCall
        isClientTool?:      boolean
      }
  > {
    const snapshot = await options.runStore.consume(subRunId)
    if (!snapshot) {
      throw new Error(`[ai-sdk] resumeAsTool: subRunId "${subRunId}" expired or never existed.`)
    }

    const pauseKind: SubAgentPauseKind = snapshot.pauseKind ?? 'client_tool'
    const pending = new Set(snapshot.pendingToolCallIds)

    let messages: AiMessage[]
    const promptOpts: AgentPromptOptions = { toolCallStreamingMode: 'stop-on-client-tool' }

    if (pauseKind === 'client_tool') {
      // Forgery guard — every incoming tool-result id must be in the pending set.
      const seen = new Set<string>()
      for (const r of clientToolResults) {
        if (!pending.has(r.toolCallId)) {
          throw new Error(`[ai-sdk] resumeAsTool: toolCallId "${r.toolCallId}" was not in the pending set.`)
        }
        if (seen.has(r.toolCallId)) {
          throw new Error(`[ai-sdk] resumeAsTool: duplicate result for toolCallId "${r.toolCallId}".`)
        }
        seen.add(r.toolCallId)
      }

      // Append client tool-result messages to the snapshot, in incoming order.
      messages = [...snapshot.messages]
      for (const r of clientToolResults) {
        messages.push({
          role:       'tool',
          content:    typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
          toolCallId: r.toolCallId,
        })
      }
    } else {
      // Approval-pause resume — clientToolResults must be empty; either an
      // approval or a rejection must be supplied for the pending id.
      if (clientToolResults.length > 0) {
        throw new Error('[ai-sdk] resumeAsTool: snapshot.pauseKind === "approval" but clientToolResults was non-empty. Pass `approvedToolCallIds` or `rejectedToolCallIds` instead.')
      }
      const approved = options.approvedToolCallIds ?? []
      const rejected = options.rejectedToolCallIds ?? []
      for (const id of approved) {
        if (!pending.has(id)) {
          throw new Error(`[ai-sdk] resumeAsTool: approvedToolCallId "${id}" was not in the pending set.`)
        }
      }
      for (const id of rejected) {
        if (!pending.has(id)) {
          throw new Error(`[ai-sdk] resumeAsTool: rejectedToolCallId "${id}" was not in the pending set.`)
        }
      }
      if (approved.length === 0 && rejected.length === 0) {
        throw new Error('[ai-sdk] resumeAsTool: snapshot.pauseKind === "approval" requires `approvedToolCallIds` or `rejectedToolCallIds`.')
      }

      messages = [...snapshot.messages]
      if (approved.length > 0) promptOpts.approvedToolCallIds = approved
      if (rejected.length > 0) promptOpts.rejectedToolCallIds = rejected
    }

    promptOpts.messages = messages

    // Default path: non-streaming resume — one prompt() call, one response.
    // Opt-in streaming path: run the inner loop via stream() and forward each
    // projected chunk to onUpdate, so a host can keep a resumed sub-agent's
    // progress live across the round-trip. Either way `result` is the same
    // AgentResponse and the pause/completion partition below is unchanged.
    let result: AgentResponse
    if (options.streaming) {
      const project: ChunkProjector = options.streaming === true ? defaultSubAgentProjector : options.streaming
      const { stream, response } = options.agent.stream('', promptOpts)
      const ctx = { originalSubRunId: subRunId, ...(options.key !== undefined ? { key: options.key } : {}) }
      for await (const chunk of stream) {
        const update = project(chunk, ctx)
        if (update && options.onUpdate) await options.onUpdate(update)
      }
      result = await response
    } else {
      result = await options.agent.prompt('', promptOpts)
    }

    if (
      result.finishReason === 'client_tool_calls' &&
      result.pendingClientToolCalls?.length
    ) {
      const newSubRunId = generateSubRunId()
      const newSnapshot: SubAgentRunSnapshot = {
        messages:           buildResumeSnapshotMessages(messages, result),
        pendingToolCallIds: result.pendingClientToolCalls.map((tc) => tc.id),
        stepsSoFar:         snapshot.stepsSoFar + result.steps.length,
        tokensSoFar:        snapshot.tokensSoFar + (result.usage?.totalTokens ?? 0),
        pauseKind:          'client_tool',
        ...(snapshot.meta !== undefined ? { meta: snapshot.meta } : {}),
      }
      await options.runStore.store(newSubRunId, newSnapshot)
      return {
        kind:               'paused',
        subRunId:           newSubRunId,
        pauseKind:          'client_tool',
        pendingToolCallIds: newSnapshot.pendingToolCallIds,
      }
    }

    if (
      result.finishReason === 'tool_approval_required' &&
      result.pendingApprovalToolCall
    ) {
      const newSubRunId = generateSubRunId()
      const { toolCall: pendingCall, isClientTool } = result.pendingApprovalToolCall
      const newSnapshot: SubAgentRunSnapshot = {
        messages:                buildResumeSnapshotMessages(messages, result),
        pendingToolCallIds:      [pendingCall.id],
        stepsSoFar:              snapshot.stepsSoFar + result.steps.length,
        tokensSoFar:             snapshot.tokensSoFar + (result.usage?.totalTokens ?? 0),
        pauseKind:               'approval',
        pendingApprovalToolCall: { toolCall: pendingCall, isClientTool },
        ...(snapshot.meta !== undefined ? { meta: snapshot.meta } : {}),
      }
      await options.runStore.store(newSubRunId, newSnapshot)
      return {
        kind:               'paused',
        subRunId:           newSubRunId,
        pauseKind:          'approval',
        pendingToolCallIds: newSnapshot.pendingToolCallIds,
        toolCall:           pendingCall,
        isClientTool,
      }
    }

    return { kind: 'completed', response: result }
  }

  /**
   * Resume MANY paused sub-agents in one call and aggregate their pending
   * tool calls into a single client round-trip.
   *
   * When an orchestrator dispatches several sub-agents in one parent turn
   * and more than one pauses on a client tool (or approval gate), the host
   * would otherwise loop over {@link Agent.resumeAsTool} by hand and stitch
   * the pending sets back together. This does that: each request resumes its
   * own `(subRunId, agent)` snapshot, and the result carries the combined
   * `completed` / `paused` / `errors` partition plus the flattened
   * `pendingToolCallIds` the host collects the next batch of results for.
   *
   * Re-entrant: feed the next round of `clientToolResults` / approvals back
   * in as a fresh batch keyed off each paused item's NEW `subRunId` until
   * `allCompleted` is `true`.
   *
   * @example
   * let batch = await Agent.resumeManyAsTool(
   *   paused.map(p => ({ subRunId: p.subRunId, agent: p.agent, clientToolResults: results[p.subRunId] })),
   *   { runStore },
   * )
   * // batch.pendingToolCallIds → gather the next round from the browser, repeat.
   */
  static async resumeManyAsTool(
    requests: ReadonlyArray<SubAgentResumeRequest>,
    options:  SubAgentResumeManyOptions,
  ): Promise<SubAgentResumeManyResult> {
    const onError     = options.onError     ?? 'capture'
    const concurrency = options.concurrency ?? 'parallel'

    const runOne = async (req: SubAgentResumeRequest): Promise<SubAgentResumeOutcome> => {
      const base = { originalSubRunId: req.subRunId, ...(req.key !== undefined ? { key: req.key } : {}) }
      try {
        const opts: SubAgentResumeOptions = { runStore: options.runStore, agent: req.agent }
        if (req.approvedToolCallIds) opts.approvedToolCallIds = req.approvedToolCallIds
        if (req.rejectedToolCallIds) opts.rejectedToolCallIds = req.rejectedToolCallIds
        // Thread the shared projector + correlate each update back to this item.
        if (options.streaming !== undefined) opts.streaming = options.streaming
        if (req.key !== undefined) opts.key = req.key
        if (options.onUpdate) {
          const batchOnUpdate = options.onUpdate
          opts.onUpdate = (update) => batchOnUpdate(update, base)
        }

        const r = await Agent.resumeAsTool(req.subRunId, req.clientToolResults ?? [], opts)
        if (r.kind === 'completed') return { ...base, kind: 'completed', response: r.response }
        return {
          ...base,
          kind:               'paused',
          subRunId:           r.subRunId,
          pauseKind:          r.pauseKind,
          pendingToolCallIds: r.pendingToolCallIds,
          ...(r.toolCall     !== undefined ? { toolCall: r.toolCall } : {}),
          ...(r.isClientTool !== undefined ? { isClientTool: r.isClientTool } : {}),
        }
      } catch (err) {
        if (onError === 'throw') throw err
        return { ...base, kind: 'error', error: err instanceof Error ? err : new Error(String(err)) }
      }
    }

    let results: SubAgentResumeOutcome[]
    if (concurrency === 'serial') {
      results = []
      for (const req of requests) results.push(await runOne(req))
    } else {
      results = await Promise.all(requests.map(runOne))
    }

    const paused    = results.filter((o): o is Extract<SubAgentResumeOutcome, { kind: 'paused' }>    => o.kind === 'paused')
    const completed = results.filter((o): o is Extract<SubAgentResumeOutcome, { kind: 'completed' }> => o.kind === 'completed')
    const errors    = results.filter((o): o is Extract<SubAgentResumeOutcome, { kind: 'error' }>     => o.kind === 'error')

    return {
      results,
      paused,
      completed,
      errors,
      pendingToolCallIds: paused.flatMap((p) => p.pendingToolCallIds),
      allCompleted:       paused.length === 0 && errors.length === 0,
    }
  }
}

// ─── asTool helpers ──────────────────────────────────────

/**
 * Projects an inner-agent {@link StreamChunk} into a {@link SubAgentUpdate} the
 * host can render, or `null` to suppress it. Used by both {@link Agent.asTool}
 * (`streaming`) and the streaming resume path ({@link SubAgentResumeOptions.streaming}).
 *
 * On the resume paths the projector also receives a `ctx` 2nd arg carrying the
 * originating sub-run's `originalSubRunId` (and the host `key` when batched via
 * {@link Agent.resumeManyAsTool}), so a side-effect projector can fan a raw
 * chunk out to the correct per-sub-agent channel and return `null`:
 *
 * ```ts
 * streaming: (chunk, ctx) => { pumpToChannel(ctx!.originalSubRunId, chunk); return null }
 * ```
 *
 * `ctx` is optional — {@link Agent.asTool}'s initial-dispatch path omits it, and
 * existing projectors that ignore the arg are unaffected.
 */
export type ChunkProjector = (
  chunk: StreamChunk,
  ctx?:  { originalSubRunId: string; key?: string },
) => SubAgentUpdate | null

/**
 * Default projection from inner-agent stream chunks to {@link SubAgentUpdate}
 * events. Emits one `tool_call` per inner `tool-call` chunk and
 * `agent_pending_approval` per inner `pending-approval` chunk; everything
 * else is suppressed (the wrapping execute emits the `agent_start` /
 * `agent_done` bookends and the suspend paths emit `subagent_paused` /
 * `subagent_paused_approval`).
 *
 * Hosts wanting different cadence (e.g. surfacing `text-delta` previews
 * or per-step usage) pass `streaming: chunk => …` and own the discriminator.
 */
function defaultSubAgentProjector(chunk: StreamChunk): SubAgentUpdate | null {
  if (chunk.type === 'tool-call' && chunk.toolCall?.name) {
    return {
      kind: 'tool_call',
      tool: chunk.toolCall.name,
      ...(chunk.toolCall.arguments ? { args: chunk.toolCall.arguments as Record<string, unknown> } : {}),
    }
  }
  if (chunk.type === 'pending-approval' && chunk.toolCall && chunk.toolCall.id && chunk.toolCall.name) {
    return {
      kind:         'agent_pending_approval',
      toolCall:     chunk.toolCall as ToolCall,
      isClientTool: !!chunk.isClientTool,
    }
  }
  return null
}

/**
 * Live-progress option shared by {@link Agent.asTool} and the streaming resume
 * surface: `true` uses {@link defaultSubAgentProjector}; a function is your own
 * {@link ChunkProjector}.
 */
export type AsToolStreamingOption  = boolean | ChunkProjector
type AsToolSuspendableOption = { runStore: SubAgentRunStore }

/**
 * Reconstruct the inner-agent message history at the point the loop
 * paused, so a subsequent {@link Agent.resumeAsTool} can rerun the loop
 * with the appended client tool results. The shape is `[user, …(message
 * + serverToolResults)*]` — system messages are omitted because the
 * `messages` mode of the agent loop prepends `system` itself.
 *
 * Each step's `message` includes ALL `toolCalls` (server + client).
 * Server-side `toolResults` are interleaved; client-side calls remain
 * unfulfilled until resume appends their results.
 */
function buildSubAgentSnapshotMessages(userPrompt: string, response: AgentResponse): AiMessage[] {
  const out: AiMessage[] = [{ role: 'user', content: userPrompt }]
  for (const step of response.steps) {
    out.push(step.message)
    for (const tr of step.toolResults) {
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
      out.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
    }
  }
  return out
}

/**
 * Snapshot reconstruction for a resume-time pause. The `priorMessages`
 * already include the original user prompt + every step prior to the
 * resume call. Append the freshly-completed steps' messages and any
 * server-side tool results so the next resume sees the full history.
 */
function buildResumeSnapshotMessages(priorMessages: AiMessage[], response: AgentResponse): AiMessage[] {
  const out: AiMessage[] = [...priorMessages]
  for (const step of response.steps) {
    out.push(step.message)
    for (const tr of step.toolResults) {
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
      out.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
    }
  }
  return out
}

function generateSubRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// ─── Conversable Agent (conversation persistence) ───────

/**
 * Wraps an Agent to add conversation memory.
 * Created via `agent.forUser(id)` or `agent.continue(id)`.
 */
export class ConversableAgent {
  private _userId: string | undefined
  private _conversationId: string | undefined

  constructor(private readonly agent: Agent) {}

  forUser(userId: string): this {
    this._userId = userId
    return this
  }

  continue(conversationId: string): this {
    this._conversationId = conversationId
    return this
  }

  async prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
    const spec = this.toSpec()
    return runWithPersistence(
      spec,
      this.agent.constructor.name,
      resolveConversationStore,
      input,
      options,
      (effOptions) => runAgentLoop(this.agent, input, effOptions),
    ).then((r) => {
      // Track the resolved id back on the wrapper so a subsequent
      // `wrapper.prompt()` call resumes the same thread.
      if (r.conversationId) this._conversationId = r.conversationId
      return r
    })
  }

  stream(input: string, options?: AgentPromptOptions): AgentStreamResponse {
    const spec = this.toSpec()
    const persisted = runWithPersistenceStreaming(
      spec,
      this.agent.constructor.name,
      resolveConversationStore,
      input,
      options,
      (effOptions) => runAgentLoopStreaming(this.agent, input, effOptions),
    )
    // Update the wrapper's id once the run completes.
    persisted.response.then(
      (r) => { if (r.conversationId) this._conversationId = r.conversationId },
      () => {},
    )
    return persisted
  }

  /**
   * Translate the wrapper's explicit-form state (`forUser` / `continue`)
   * into a {@link ConversationalSpec}. The explicit chain bypasses the
   * agent's `conversational()` declaration entirely — `forUser` always
   * wins over class defaults.
   */
  private toSpec(): ConversationalSpec {
    if (this._conversationId) return { user: this._userId ?? '', id: this._conversationId }
    if (this._userId)         return { user: this._userId }
    throw new Error('[ai-sdk] ConversableAgent requires forUser() or continue() to be called before prompt().')
  }
}

// ─── Anonymous Agent ─────────────────────────────────────

class AnonymousAgent extends Agent {
  private readonly _instructions: string
  private readonly _tools: AnyTool[]
  private readonly _model: string | undefined
  private readonly _middleware: AiMiddleware[]

  constructor(options: {
    instructions: string
    tools?: AnyTool[] | undefined
    model?: string | undefined
    middleware?: AiMiddleware[] | undefined
  }) {
    super()
    this._instructions = options.instructions
    this._tools = options.tools ?? []
    this._model = options.model
    this._middleware = options.middleware ?? []
  }

  instructions(): string { return this._instructions }
  model(): string | undefined { return this._model }
  tools(): AnyTool[] { return this._tools }
  middleware(): AiMiddleware[] { return this._middleware }
}

/**
 * Create an anonymous agent inline.
 *
 * @example
 * const response = await agent('You are helpful.').prompt('Hello')
 *
 * @example
 * const response = await agent({
 *   instructions: 'You are a search assistant.',
 *   tools: [searchTool],
 *   model: 'anthropic/claude-sonnet-4-5',
 * }).prompt('Find users named John')
 */
export function agent(
  instructionsOrOptions: string | {
    instructions: string
    tools?: AnyTool[] | undefined
    model?: string | undefined
    middleware?: AiMiddleware[] | undefined
  },
): Agent & HasTools & HasMiddleware {
  const options = typeof instructionsOrOptions === 'string'
    ? { instructions: instructionsOrOptions }
    : instructionsOrOptions
  return new AnonymousAgent(options) as Agent & HasTools & HasMiddleware
}

// ─── Helpers ─────────────────────────────────────────────

// ─── Conversation Store Registry ────────────────────────

let _conversationStore: ConversationStore | undefined

/** Set the global conversation store (called by service provider or manually) */
export function setConversationStore(store: ConversationStore): void {
  _conversationStore = store
}

function resolveConversationStore(): ConversationStore | undefined {
  return _conversationStore
}

// ─── User Memory Registry (#A4) ──────────────────────────

let _userMemory: UserMemory | undefined

/**
 * Set the global {@link UserMemory} (called by `AiProvider` from
 * `AiConfig.memory`, or manually for tests / standalone setups).
 * Phase 2/3 middleware reads it via `resolveUserMemory()` —
 * imported by the persistence layer the same way
 * `resolveConversationStore` is wired today.
 */
export function setUserMemory(memory: UserMemory): void {
  _userMemory = memory
}

export function resolveUserMemory(): UserMemory | undefined {
  return _userMemory
}

/**
 * Streaming counterpart of `Agent.prompt`'s auto-persist branch. The spec
 * resolution is async (since `conversational()` may return a Promise), so
 * we defer the decision into the outer wrapper that handles the inner
 * stream's setup the same way `runWithPersistenceStreaming` does for the
 * persisted path.
 */
function runStreamWithMaybeAutoPersist(
  a:       Agent,
  input:   string,
  options: AgentPromptOptions | undefined,
): AgentStreamResponse {
  // Synchronous fast path — most agents override neither `conversational()`
  // nor `remembers()`. Skip the async outer entirely when we can prove
  // both are no-ops, sparing a microtask boundary per streaming call.
  const declaredConv = a.conversational()
  const declaredMem  = a.remembers()
  const isFast = (
    (options?.conversation === false ||
      (declaredConv === false && options?.conversation === undefined))
    && (options?.memory === false ||
      (declaredMem === false && options?.memory === undefined) ||
      options?.messages !== undefined)
  )
  if (isFast) {
    return runAgentLoopStreaming(a, input, options)
  }

  // Async path — resolve memory + conversation specs, then dispatch.
  let resolveResp: (r: AgentResponse) => void
  let rejectResp:  (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((res, rej) => { resolveResp = res; rejectResp = rej })

  async function* outer(): AsyncIterable<StreamChunk> {
    let effOptions: AgentPromptOptions | undefined
    let spec: ConversationalSpec | null
    try {
      // Memory auto-cascade BEFORE conversation persistence — same
      // ordering as the non-streaming `Agent.prompt` path.
      effOptions = await prepareOptionsWithMemoryAutoCascade(a, options)
      spec = await resolveAutoPersistSpec(() => a.conversational(), effOptions?.conversation)
    } catch (err) {
      rejectResp!(err)
      throw err
    }

    if (!spec) {
      const inner = runAgentLoopStreaming(a, input, effOptions)
      try {
        for await (const chunk of inner.stream) yield chunk
      } catch (err) {
        rejectResp!(err)
        throw err
      }
      try {
        const r = await inner.response
        resolveResp!(r)
      } catch (err) {
        rejectResp!(err)
        throw err
      }
      return
    }

    const persisted = runWithPersistenceStreaming(
      spec,
      a.constructor.name,
      resolveConversationStore,
      input,
      effOptions,
      (innerOptions) => runAgentLoopStreaming(a, input, innerOptions),
    )

    try {
      for await (const chunk of persisted.stream) yield chunk
    } catch (err) {
      rejectResp!(err)
      throw err
    }
    try {
      const r = await persisted.response
      resolveResp!(r)
    } catch (err) {
      rejectResp!(err)
      throw err
    }
  }

  return { stream: outer(), response: responsePromise }
}

// ─── Helpers ─────────────────────────────────────────────

function hasToolsMethod(a: Agent): a is Agent & HasTools {
  return 'tools' in a && typeof (a as { tools?: unknown }).tools === 'function'
}

function getTools(a: Agent): AnyTool[] {
  return hasToolsMethod(a) ? a.tools() : []
}

/**
 * Internal symbol used to plumb auto-installed middlewares (today:
 * memory-inject; future: budget-tracker, etc.) through the public
 * `AgentPromptOptions` without polluting its surface. Resolution
 * happens at the `Agent.prompt` / `Agent.stream` boundary; the loop
 * just appends them to the user's `agent.middleware()` array.
 */
const EXTRA_MIDDLEWARES = Symbol.for('rudderjs.ai.extraMiddlewares')

interface ExtraMiddlewareOptions {
  [EXTRA_MIDDLEWARES]?: AiMiddleware[]
}

function hasMiddlewareMethod(a: Agent): a is Agent & HasMiddleware {
  return 'middleware' in a && typeof (a as { middleware?: unknown }).middleware === 'function'
}

function getMiddleware(a: Agent, options?: AgentPromptOptions): AiMiddleware[] {
  const own = hasMiddlewareMethod(a) ? a.middleware() : []
  const extras = (options as (AgentPromptOptions & ExtraMiddlewareOptions) | undefined)?.[EXTRA_MIDDLEWARES] ?? []
  return extras.length > 0 ? [...own, ...extras] : own
}

/**
 * Resolve the effective `remembers()` spec and append the appropriate
 * memory middlewares (inject for Phase 2, extract for Phase 3) to the
 * options' hidden extras list. Skips entirely on:
 * - continuation calls (`options.messages` set) — the system message
 *   was already augmented on the original `prompt()`, re-injecting
 *   would duplicate the block on every tool round-trip; re-extracting
 *   would also double-write the same facts on every round-trip.
 * - specs where neither `inject === 'auto'` nor `extract === 'auto'`
 *   apply.
 *
 * Returns options unchanged when no auto-cascade is needed so the
 * downstream conversational/loop path sees the original reference.
 */
async function prepareOptionsWithMemoryAutoCascade(
  a:        Agent,
  options?: AgentPromptOptions,
): Promise<AgentPromptOptions | undefined> {
  if (options?.messages) return options

  const spec = await resolveRemembersSpec(() => a.remembers(), options?.memory)
  if (!spec) return options

  const installed: AiMiddleware[] = []
  if (spec.inject === 'auto')                      installed.push(withMemoryInject(spec))
  if (spec.extract === 'auto' && spec.extractWith) installed.push(withMemoryExtract(spec))
  if (installed.length === 0) return options

  const current = (options as (AgentPromptOptions & ExtraMiddlewareOptions) | undefined)?.[EXTRA_MIDDLEWARES] ?? []
  return {
    ...options,
    [EXTRA_MIDDLEWARES]: [...current, ...installed],
  } as AgentPromptOptions
}

function createMiddlewareContext(
  messages: AiMessage[],
  model: string,
  tools: AnyTool[],
  iteration: number,
): MiddlewareContext {
  const [provider] = AiRegistry.parseModelString(model)
  let aborted = false
  let abortReason = ''
  return {
    requestId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`,
    iteration,
    chunkIndex: 0,
    messages,
    model,
    provider,
    toolNames: tools.map(t => t.definition.name),
    abort(reason?: string) {
      aborted = true
      abortReason = reason ?? 'Aborted by middleware'
    },
    get _aborted() { return aborted },
    get _abortReason() { return abortReason },
  } as MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }
}

function buildUserMessage(input: string, attachments?: Attachment[]): AiMessage {
  if (!attachments?.length) return { role: 'user', content: input }
  const parts: ContentPart[] = [
    { type: 'text', text: input },
    ...attachmentsToContentParts(attachments),
  ]
  return { role: 'user', content: parts }
}

function buildToolSchemas(tools: AnyTool[]): ReturnType<typeof toolToSchema>[] {
  return tools.filter(t => !t.definition.lazy).map(toolToSchema)
}

function buildToolMap(tools: AnyTool[]): Map<string, AnyTool> {
  const map = new Map<string, AnyTool>()
  for (const t of tools) map.set(t.definition.name, t)
  return map
}

function addUsage(total: TokenUsage, step: TokenUsage): void {
  total.promptTokens += step.promptTokens
  total.completionTokens += step.completionTokens
  total.totalTokens += step.totalTokens
}

/**
 * Merge two `TokenUsage` snapshots emitted within a single step, taking the
 * MAX per field. Stream providers may emit usage in multiple chunks (e.g.
 * Anthropic's `message_start` carries promptTokens, `message_delta` carries
 * completionTokens) — a naive last-wins overwrite drops correct earlier
 * values when later chunks under-report. MAX is safe because every chunk is
 * a running snapshot, not a delta: token counts only ever grow within a step.
 *
 * @internal — exported for testing only.
 */
export function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens:     Math.max(a.promptTokens,     b.promptTokens),
    completionTokens: Math.max(a.completionTokens, b.completionTokens),
    totalTokens:      Math.max(a.totalTokens,      b.totalTokens),
  }
}

function buildMiddlewareConfig(messages: AiMessage[], a: Agent): import('./types.js').MiddlewareConfigResult {
  const config: import('./types.js').MiddlewareConfigResult = { messages }
  const temp = a.temperature()
  const maxTok = a.maxTokens()
  if (temp !== undefined) config.temperature = temp
  if (maxTok !== undefined) config.maxTokens = maxTok
  return config
}

// ─── Shared loop state ───────────────────────────────────

/**
 * Mutable state shared between the non-streaming and streaming agent loops.
 * Helpers (`runFailover`, `emitObserverFailed`, `emitObserverCompleted`,
 * `buildAgentResponse`) read and write this struct so the same orchestration
 * logic serves both `prompt()` and `stream()` callers.
 */
export interface LoopContext {
  // immutable per call
  readonly agent:        Agent
  readonly input:        string
  readonly options:      AgentPromptOptions | undefined
  readonly modelString:  string
  readonly providerName: string
  readonly tools:        AnyTool[]
  readonly toolMap:      Map<string, AnyTool>
  readonly toolSchemas:  ReturnType<typeof toolToSchema>[]
  readonly middlewares:  AiMiddleware[]
  readonly loopStart:    number
  readonly ctx:          MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

  // mutable
  readonly messages:                 AiMessage[]
  readonly steps:                    AgentStep[]
  readonly totalUsage:               TokenUsage
  readonly pendingClientToolCalls:   ToolCall[]
  pendingApprovalToolCall:           { toolCall: ToolCall; isClientTool: boolean } | undefined
  loopFinishReason:                  FinishReason | undefined
  stopForClientTools:                boolean
  stopForApproval:                   boolean
  resumedToolMessages:               AiMessage[]
  failoverAttempts:                  number
  /**
   * Set by the tool phase when the model called a {@link handoff} tool.
   * Triggers the parent loop to break and the handoff wrapper to construct
   * the child agent and continue with the carried message history.
   */
  pendingHandoff?:                   PendingHandoff
  stopForHandoff:                    boolean
}

export type { PendingHandoff } from './handoffs-driver.js'

/**
 * Iterate the failover model list and invoke `call` against each provider
 * adapter until one succeeds. Mutates `loopCtx.failoverAttempts` so the
 * observer event reflects the real number of attempts. A caller-supplied
 * `AbortSignal` short-circuits — abort errors propagate immediately rather
 * than triggering the next failover model.
 */
async function runFailover<T>(
  loopCtx: LoopContext,
  currentModel: string,
  call: (adapter: import('./types.js').ProviderAdapter, modelId: string, opts: ProviderRequestOptions) => T | Promise<T>,
): Promise<T> {
  const failoverModels = [currentModel, ...loopCtx.agent.failover().filter(m => m !== currentModel)]
  let lastError: Error | undefined
  for (const tryModel of failoverModels) {
    try {
      const adapter = AiRegistry.resolve(tryModel)
      const [, modelId] = AiRegistry.parseModelString(tryModel)
      const reqOptions: ProviderRequestOptions = {
        model:       modelId,
        messages:    loopCtx.messages,
        tools:       loopCtx.toolSchemas.length > 0 ? loopCtx.toolSchemas : undefined,
        temperature: loopCtx.agent.temperature(),
        maxTokens:   loopCtx.agent.maxTokens(),
        signal:      loopCtx.options?.signal,
        cache:       resolveCacheMarkers(loopCtx.agent, loopCtx.options),
      }
      return await call(adapter, modelId, reqOptions)
    } catch (err) {
      // If the abort came from the caller, don't try the next failover
      // model — re-throw so `prompt()` / the stream rejects immediately.
      if (loopCtx.options?.signal?.aborted) throw loopCtx.options.signal.reason
      lastError = err instanceof Error ? err : new Error(String(err))
      loopCtx.failoverAttempts++
      if (tryModel === failoverModels[failoverModels.length - 1]) throw lastError
    }
  }
  throw lastError ?? new Error('No provider available')
}

/**
 * Merge agent-level `cacheable()` declaration with per-call override.
 *
 * - Per-call `cache: false` → returns `undefined` (caching disabled).
 * - Per-call `cache: { ... }` → replaces the agent default.
 * - Per-call omitted → uses `agent.cacheable()` unchanged.
 *
 * Returns `undefined` when no markers are set so the provider request
 * carries no `cache` field at all.
 */
function resolveCacheMarkers(
  agent: Agent,
  options: AgentPromptOptions | undefined,
): CacheableMarkers | undefined {
  if (options && options.cache === false) return undefined
  const perCall = options?.cache === false ? undefined : options?.cache
  const config: CacheableConfig | undefined = perCall ?? agent.cacheable()
  if (!config) return undefined
  const markers: CacheableMarkers = {}
  if (config.instructions) markers.instructions = true
  if (config.tools)        markers.tools        = true
  if (config.messages !== undefined && config.messages > 0) {
    markers.messages = Math.floor(config.messages)
  }
  if (config.ttl) markers.ttl = config.ttl
  // ttl alone with no region markers is meaningless — drop it.
  const hasRegion = markers.instructions || markers.tools || (markers.messages && markers.messages > 0)
  if (!hasRegion) return undefined
  return markers
}

/** Emit the `agent.failed` observer event from the shared loop state. */
function emitObserverFailed(loopCtx: LoopContext, err: unknown, streaming: boolean): void {
  const obs = _getAiObservers()
  if (!obs) return
  const inputText = loopCtx.options?.messages ? '' : loopCtx.input
  obs.emit({
    kind:             'agent.failed',
    agentName:        loopCtx.agent.constructor.name,
    model:            loopCtx.modelString,
    provider:         loopCtx.providerName,
    input:            inputText,
    output:           '',
    steps:            _buildObserverSteps(loopCtx.steps, loopCtx.modelString),
    tokens:           {
      prompt:     loopCtx.totalUsage.promptTokens,
      completion: loopCtx.totalUsage.completionTokens,
      total:      loopCtx.totalUsage.totalTokens,
    },
    duration:         Math.round(performance.now() - loopCtx.loopStart),
    finishReason:     'error',
    streaming,
    conversationId:   null,
    failoverAttempts: loopCtx.failoverAttempts,
    error:            err instanceof Error ? err.message : String(err),
  })
}

/**
 * Emit the per-step `agent.step.completed` observer event after each
 * iteration. Built from the SAME `_buildObserverSteps` mapping used by
 * the terminal events so consumers see consistent shapes — they just see
 * the latest step rather than the full array.
 */
function emitObserverStepCompleted(
  loopCtx:   LoopContext,
  iteration: number,
  streaming: boolean,
): void {
  const obs = _getAiObservers()
  if (!obs) return
  const justPushed = loopCtx.steps[loopCtx.steps.length - 1]
  if (!justPushed) return
  // Re-use _buildObserverSteps so the per-step shape matches the steps[]
  // entries on the terminal events. Pass a single-element slice since we
  // only need the latest step's mapping.
  const built = _buildObserverSteps([justPushed], loopCtx.modelString)
  const stepEvent = built[0]
  if (!stepEvent) return
  // Override iteration with the loop's iteration counter — _buildObserverSteps
  // numbers from 1 within the array it sees, but we want the global step
  // number across the whole run.
  stepEvent.iteration = iteration + 1
  obs.emit({
    kind:           'agent.step.completed',
    agentName:      loopCtx.agent.constructor.name,
    model:          loopCtx.modelString,
    provider:       loopCtx.providerName,
    iteration:      iteration + 1,
    step:           stepEvent,
    tokens:         {
      prompt:     loopCtx.totalUsage.promptTokens,
      completion: loopCtx.totalUsage.completionTokens,
      total:      loopCtx.totalUsage.totalTokens,
    },
    duration:       Math.round(performance.now() - loopCtx.loopStart),
    streaming,
    conversationId: null,
  })
}

/** Emit the `agent.completed` observer event from the shared loop state. */
function emitObserverCompleted(loopCtx: LoopContext, result: AgentResponse, streaming: boolean): void {
  const obs = _getAiObservers()
  if (!obs) return
  const inputText = loopCtx.options?.messages ? '' : loopCtx.input
  const lastStep = loopCtx.steps[loopCtx.steps.length - 1]
  obs.emit({
    kind:             'agent.completed',
    agentName:        loopCtx.agent.constructor.name,
    model:            loopCtx.modelString,
    provider:         loopCtx.providerName,
    input:            inputText,
    output:           result.text,
    steps:            _buildObserverSteps(loopCtx.steps, loopCtx.modelString),
    tokens:           {
      prompt:     loopCtx.totalUsage.promptTokens,
      completion: loopCtx.totalUsage.completionTokens,
      total:      loopCtx.totalUsage.totalTokens,
    },
    duration:         Math.round(performance.now() - loopCtx.loopStart),
    finishReason:     result.finishReason ?? lastStep?.finishReason ?? 'stop',
    streaming,
    conversationId:   null,
    failoverAttempts: loopCtx.failoverAttempts,
  })
}

/** Build the final `AgentResponse` from accumulated loop state. */
function buildAgentResponse(loopCtx: LoopContext): AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] } {
  const lastStep = loopCtx.steps[loopCtx.steps.length - 1]
  const result: AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] } = {
    text:  lastStep ? getMessageText(lastStep.message.content) : '',
    steps: loopCtx.steps,
    usage: loopCtx.totalUsage,
  }
  if (loopCtx.loopFinishReason) result.finishReason = loopCtx.loopFinishReason
  if (loopCtx.pendingClientToolCalls.length > 0) result.pendingClientToolCalls = loopCtx.pendingClientToolCalls
  if (loopCtx.pendingApprovalToolCall) result.pendingApprovalToolCall = loopCtx.pendingApprovalToolCall
  if (loopCtx.resumedToolMessages.length > 0) result.resumedToolMessages = loopCtx.resumedToolMessages
  // Internal — consumed by the handoff-aware wrapper, then stripped before
  // surfacing to public callers.
  if (loopCtx.pendingHandoff) {
    result._pendingHandoff = loopCtx.pendingHandoff
    result._carriedMessages = loopCtx.messages
  }
  return result
}


/**
 * Build the shared `LoopContext` for a `prompt()` / `stream()` call, run
 * approval-resume, and fire `onConfig(init)` + `onStart`. After this returns,
 * the iteration loop can run with the same setup regardless of streaming
 * mode.
 */
async function initializeLoop(
  a: Agent,
  input: string,
  options: AgentPromptOptions | undefined,
): Promise<{ loopCtx: LoopContext; stopConditions: StopCondition[] }> {
  // Honor caller-supplied AbortSignal as early as possible — if the signal
  // is already aborted on entry, do no work at all.
  options?.signal?.throwIfAborted()

  const loopStart = performance.now()
  const modelString = a.model() ?? AiRegistry.getDefault()
  const [providerName] = AiRegistry.parseModelString(modelString)
  const tools = getTools(a)
  const middlewares = getMiddleware(a, options)
  const toolSchemas = buildToolSchemas(tools)
  const toolMap = buildToolMap(tools)

  const messages: AiMessage[] = options?.messages
    ? [{ role: 'system', content: a.instructions() }, ...options.messages]
    : [
      { role: 'system', content: a.instructions() },
      ...(options?.history ?? []),
      buildUserMessage(input, options?.attachments),
    ]

  const steps: AgentStep[] = []
  const stopConditions = normalizeStopConditions(a.stopWhen())
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Create middleware context (resume below mutates `messages`, captured by
  // reference here, so order is safe).
  const ctx = createMiddlewareContext(messages, modelString, tools, 0) as MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

  const loopCtx: LoopContext = {
    agent:                   a,
    input,
    options,
    modelString,
    providerName,
    tools,
    toolMap,
    toolSchemas,
    middlewares,
    loopStart,
    ctx,
    messages,
    steps,
    totalUsage,
    pendingClientToolCalls:  [],
    pendingApprovalToolCall: undefined,
    loopFinishReason:        undefined,
    stopForClientTools:      false,
    stopForApproval:         false,
    resumedToolMessages:     [],
    failoverAttempts:        0,
    stopForHandoff:          false,
  }

  // Resume server tools left pending by a previous approval round-trip.
  {
    const resume = await resumePendingToolCalls({ messages, toolMap, options })
    loopCtx.resumedToolMessages = resume.resumed
    if (resume.approvalStillRequired) {
      loopCtx.pendingApprovalToolCall = resume.approvalStillRequired
      loopCtx.loopFinishReason = 'tool_approval_required'
      loopCtx.stopForApproval = true
    }
  }

  // onConfig — init phase
  if (middlewares.length > 0) {
    const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, a), 'init')
    if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
  }

  // onStart
  if (middlewares.length > 0) await runSequential(middlewares, 'onStart', ctx)

  return { loopCtx, stopConditions }
}

/**
 * Run the per-iteration prelude — caller-abort check, middleware-abort
 * check, `onIteration`, `prepareStep`, `onConfig(beforeModel)`. Returns the
 * resolved model for this step or `{ aborted: true }` if middleware
 * cancelled the run (caller should `break`). Throws the abort reason if a
 * caller-supplied AbortSignal fired between iterations.
 */
async function runIterationPrelude(
  loopCtx: LoopContext,
  iteration: number,
): Promise<{ currentModel: string } | { aborted: true }> {
  const { agent, options, ctx, middlewares, messages, modelString, steps } = loopCtx
  ctx.iteration = iteration
  // Reset the streaming chunk index for middlewares that key off it. Harmless
  // in non-streaming mode where no chunks flow through `onChunk`.
  ctx.chunkIndex = 0

  // Honor caller-supplied AbortSignal between iterations.
  options?.signal?.throwIfAborted()

  if (ctx._aborted) {
    await runOnAbort(middlewares, ctx, ctx._abortReason)
    return { aborted: true }
  }

  if (middlewares.length > 0) await runSequential(middlewares, 'onIteration', ctx)

  let currentModel = modelString

  if (agent.prepareStep) {
    const prep = await agent.prepareStep({ stepNumber: iteration, steps, messages })
    if (prep.model) currentModel = prep.model
    if (prep.messages) messages.splice(0, messages.length, ...prep.messages)
    if (prep.system) messages[0] = { role: 'system', content: prep.system }
  }

  if (middlewares.length > 0) {
    const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, agent), 'beforeModel')
    if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
  }

  return { currentModel }
}

// ─── Agent Loop (non-streaming) ──────────────────────────

/**
 * Public entry point for the non-streaming agent loop. Drives
 * {@link runAgentLoopOnce} once, then — if the model called a {@link handoff}
 * tool — constructs the target agent, carries the conversation forward, and
 * recurses. Steps and usage from each hop are merged; the final `text` and
 * `finishReason` come from the agent that produced the terminal answer.
 * `handoffPath` records the chain of class names traversed.
 */
async function runAgentLoop(a: Agent, input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
  const onceResult = await runAgentLoopOnce(a, input, options) as AgentResponse & {
    _pendingHandoff?: PendingHandoff
    _carriedMessages?: AiMessage[]
  }
  if (!onceResult._pendingHandoff) {
    return stripInternal(onceResult)
  }
  const merged = await driveHandoffs(a.constructor.name, onceResult, onceResult._pendingHandoff, onceResult._carriedMessages ?? [], options, 0, runAgentLoopOnce)
  return merged
}

/**
 * Streaming counterpart to {@link runAgentLoop}. Iterates handoffs and
 * pivots the stream to the next agent each time the parent ends with a
 * pending handoff. Chunks from every hop flow through the same returned
 * `AsyncIterable`; the resolved `response` carries the merged final state.
 */
function runAgentLoopStreaming(a: Agent, input: string, options?: AgentPromptOptions): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  let rejectResponse: (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })

  async function* generateStream(): AsyncIterable<StreamChunk> {
    let currentAgent = a
    let currentInput = input
    let currentOpts: AgentPromptOptions | undefined = options
    const mergedSteps: AgentStep[] = []
    const mergedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const handoffPath: string[] = []
    let finalResponse: AgentResponse | undefined

    for (let hop = 0; hop <= MAX_HANDOFFS; hop++) {
      const onceStream = runAgentLoopStreamingOnce(currentAgent, currentInput, currentOpts)
      // Attach a no-op handler so a rejection from the inner response
      // promise (e.g. caller-supplied AbortSignal firing mid-stream) is
      // already observed by the time the `for await` re-throws — without
      // this, Node logs an unhandledRejection between the stream's throw
      // and our outer `withRejectOnError`'s catch.
      onceStream.response.catch(() => {})
      for await (const chunk of onceStream.stream) yield chunk
      const r = await onceStream.response as AgentResponse & {
        _pendingHandoff?: PendingHandoff
        _carriedMessages?: AiMessage[]
      }

      mergedSteps.push(...r.steps)
      addUsage(mergedUsage, r.usage)

      if (r._pendingHandoff && hop < MAX_HANDOFFS) {
        handoffPath.push(currentAgent.constructor.name)
        const ChildClass = r._pendingHandoff.spec.AgentClass
        currentAgent = new (ChildClass as new () => Agent)()
        currentInput = r._pendingHandoff.transitionMessage
        currentOpts = buildHandoffChildOptions(options, r._carriedMessages ?? [])
        continue
      }

      if (r._pendingHandoff) {
        throw new Error(`[ai-sdk] Exceeded max handoffs (${MAX_HANDOFFS}). Likely a cycle between agents.`)
      }

      finalResponse = handoffPath.length === 0
        ? stripInternal(r)
        : mergeFinalHandoff(stripInternal(r), mergedSteps, mergedUsage, handoffPath, currentAgent.constructor.name)
      break
    }

    if (!finalResponse) {
      throw new Error(`[ai-sdk] Exceeded max handoffs (${MAX_HANDOFFS}). Likely a cycle between agents.`)
    }
    resolveResponse(finalResponse)
  }

  async function* withRejectOnError(): AsyncIterable<StreamChunk> {
    try {
      yield* generateStream()
    } catch (err) {
      rejectResponse(err)
      throw err
    }
  }

  return {
    stream: withRejectOnError(),
    response: responsePromise,
  }
}


async function runAgentLoopOnce(a: Agent, input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
  const { loopCtx, stopConditions } = await initializeLoop(a, input, options)
  const { ctx, middlewares, messages, steps, totalUsage } = loopCtx

  try {
    if (loopCtx.stopForApproval) {
      // Approval is still required from the resume — skip the model loop.
    } else {
    for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
      const prelude = await runIterationPrelude(loopCtx, iteration)
      if ('aborted' in prelude) break
      const { currentModel } = prelude

      const response = await runFailover(loopCtx, currentModel, (adapter, _, opts) => adapter.generate(opts))
      addUsage(totalUsage, response.usage)

      // onUsage
      if (middlewares.length > 0) await runOnUsage(middlewares, ctx, response.usage)

      const toolCalls = response.message.toolCalls ?? []
      let toolResults: ToolResult[] = []

      if (toolCalls.length > 0) {
        // Drain `executeToolPhase` to completion, discarding the streamed
        // chunks — non-streaming callers don't surface them.
        const phaseGen = executeToolPhase(loopCtx, toolCalls, response.message)
        while (true) {
          const next = await phaseGen.next()
          if (next.done) {
            toolResults = next.value
            break
          }
        }
      } else {
        messages.push(response.message)
      }

      const step: AgentStep = {
        message:      response.message,
        toolCalls,
        toolResults,
        usage:        response.usage,
        finishReason: response.finishReason,
      }
      steps.push(step)
      emitObserverStepCompleted(loopCtx, iteration, false)

      if (loopCtx.stopForClientTools || loopCtx.stopForApproval || loopCtx.stopForHandoff) break

      const shouldStop = stopConditions.some(cond =>
        cond({ steps, iteration, lastMessage: response.message }),
      )
      if (shouldStop || response.finishReason !== 'tool_calls') {
        break
      }
    }
    } // close `else` (skip-loop-when-resume-needs-approval)
  } catch (err) {
    // onError
    if (middlewares.length > 0) await runOnError(middlewares, ctx, err)
    emitObserverFailed(loopCtx, err, false)
    throw err
  }

  // onFinish
  if (middlewares.length > 0) await runSequential(middlewares, 'onFinish', ctx)

  const result = buildAgentResponse(loopCtx)
  emitObserverCompleted(loopCtx, result, false)
  return result
}

// ─── Agent Loop (streaming) ──────────────────────────────

function runAgentLoopStreamingOnce(a: Agent, input: string, options?: AgentPromptOptions): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  let rejectResponse: (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })

  async function* generateStream(): AsyncIterable<StreamChunk> {
    const { loopCtx, stopConditions } = await initializeLoop(a, input, options)
    const { ctx, middlewares, messages, steps, totalUsage } = loopCtx

    try {
      if (loopCtx.stopForApproval) {
        // Resume detected unfulfilled approval — skip the model loop entirely.
      } else {
      for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
        const prelude = await runIterationPrelude(loopCtx, iteration)
        if ('aborted' in prelude) break
        const { currentModel } = prelude

        const streamSource = await runFailover(loopCtx, currentModel, (adapter, _, opts) => adapter.stream(opts))

        let text = ''
        let currentToolCalls: ToolCall[] = []
        let stepUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        let finishReason: AgentStep['finishReason'] = 'stop'
        type PartialToolCall = { id: string; name: string; argChunks: string[] }
        const partialToolCalls = new Map<string, PartialToolCall>()
        // Parallel-arg routing — OpenAI streams ≥2 tool calls interleaved by
        // `index`. Without an index-keyed map the previous "pop last partial"
        // attached `index=1`'s arg fragments to `index=0`'s partial (or vice
        // versa), producing `{}` args or wrong args silently. Partials live in
        // both maps by reference, so the final `JSON.parse` loop below
        // continues to read from `partialToolCalls`.
        const partialsByIndex = new Map<number, PartialToolCall>()

        for await (const chunk of streamSource) {
          // onChunk — middleware can transform or drop chunks
          let processedChunk: StreamChunk | null = chunk
          if (middlewares.length > 0) {
            processedChunk = runOnChunk(middlewares, ctx, chunk)
            ctx.chunkIndex++
          }
          if (processedChunk) yield processedChunk

          // Always process the original chunk for state tracking
          if (chunk.type === 'text-delta' && chunk.text) {
            text += chunk.text
          } else if (chunk.type === 'tool-call-delta' && chunk.toolCall?.id) {
            const partial: PartialToolCall = {
              id: chunk.toolCall.id,
              name: chunk.toolCall.name ?? '',
              argChunks: [],
            }
            partialToolCalls.set(chunk.toolCall.id, partial)
            if (typeof chunk.toolCallIndex === 'number') {
              partialsByIndex.set(chunk.toolCallIndex, partial)
            }
          } else if (chunk.type === 'tool-call-delta' && chunk.text) {
            // Route arg-delta to the matching partial by `toolCallIndex` when
            // the adapter provides it (OpenAI). Fall back to the most recent
            // partial only for adapters that don't track index — those don't
            // currently stream parallel tool calls via arg-only deltas, so
            // the legacy path is still safe.
            const partial = typeof chunk.toolCallIndex === 'number'
              ? partialsByIndex.get(chunk.toolCallIndex)
              : Array.from(partialToolCalls.values()).pop()
            if (partial) partial.argChunks.push(chunk.text)
          } else if (chunk.type === 'tool-call' && chunk.toolCall) {
            const tc = chunk.toolCall as ToolCall
            currentToolCalls.push(tc)
          } else if (chunk.type === 'usage' && chunk.usage) {
            stepUsage = mergeUsage(stepUsage, chunk.usage)
          } else if (chunk.type === 'finish') {
            if (chunk.usage) stepUsage = mergeUsage(stepUsage, chunk.usage)
            finishReason = chunk.finishReason ?? 'stop'
          }
        }

        // Finalize partial tool calls
        for (const [, partial] of partialToolCalls) {
          try {
            const args = JSON.parse(partial.argChunks.join(''))
            currentToolCalls.push({ id: partial.id, name: partial.name, arguments: args })
          } catch {
            currentToolCalls.push({ id: partial.id, name: partial.name, arguments: {} })
          }
        }

        addUsage(totalUsage, stepUsage)

        // onUsage
        if (middlewares.length > 0) await runOnUsage(middlewares, ctx, stepUsage)

        let toolResults: ToolResult[] = []

        if (currentToolCalls.length > 0) {
          const assistantMsg: AiMessage = { role: 'assistant', content: text, toolCalls: currentToolCalls }
          // Forward chunks from the shared tool-phase generator straight
          // through to the stream consumer.
          const phaseGen = executeToolPhase(loopCtx, currentToolCalls, assistantMsg)
          while (true) {
            const next = await phaseGen.next()
            if (next.done) {
              toolResults = next.value
              break
            }
            yield next.value
          }
        } else {
          messages.push({ role: 'assistant', content: text })
        }

        const step: AgentStep = {
          message: { role: 'assistant', content: text, ...(currentToolCalls.length > 0 ? { toolCalls: currentToolCalls } : {}) },
          toolCalls: currentToolCalls,
          toolResults,
          usage: stepUsage,
          finishReason,
        }
        steps.push(step)
        emitObserverStepCompleted(loopCtx, iteration, true)

        if (loopCtx.stopForClientTools || loopCtx.stopForApproval || loopCtx.stopForHandoff) break

        const shouldStop = stopConditions.some(cond =>
          cond({ steps, iteration, lastMessage: step.message }),
        )
        if (shouldStop || finishReason !== 'tool_calls') break

        // Reset for next iteration
        text = ''
        currentToolCalls = []
      }
      } // close `else` (skip-loop-when-resume-needs-approval)
    } catch (err) {
      // onError
      if (middlewares.length > 0) await runOnError(middlewares, ctx, err)
      emitObserverFailed(loopCtx, err, true)
      throw err
    }

    // onFinish
    if (middlewares.length > 0) await runSequential(middlewares, 'onFinish', ctx)

    // Emit pending state to consumers via dedicated chunk types
    if (loopCtx.pendingClientToolCalls.length > 0) {
      yield { type: 'pending-client-tools', toolCalls: loopCtx.pendingClientToolCalls }
    }
    if (loopCtx.pendingApprovalToolCall) {
      yield {
        type:         'pending-approval',
        toolCall:     loopCtx.pendingApprovalToolCall.toolCall,
        isClientTool: loopCtx.pendingApprovalToolCall.isClientTool,
      }
    }

    const result = buildAgentResponse(loopCtx)
    emitObserverCompleted(loopCtx, result, true)

    resolveResponse!(result)
  }

  // Outer wrapper: if `generateStream` throws (e.g. the caller's
  // AbortSignal fired), reject the `response` promise with the same
  // reason BEFORE re-throwing into the for-await consumer. Without this,
  // `await response` would hang forever after a mid-stream abort.
  async function* withRejectOnError(): AsyncIterable<StreamChunk> {
    try {
      yield* generateStream()
    } catch (err) {
      rejectResponse!(err)
      throw err
    }
  }

  return {
    stream: withRejectOnError(),
    response: responsePromise,
  }
}

function normalizeStopConditions(cond: StopCondition | StopCondition[]): StopCondition[] {
  return Array.isArray(cond) ? cond : [cond]
}


export type { InvalidToolArgumentsError } from './tool-helpers.js'
