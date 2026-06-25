import { z } from 'zod'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import type { ToolDefinitionOptions, ToolDefinitionSchema } from './types.js'
import type { Agent } from './agent.js'

/**
 * Symbol-tagged marker identifying a handoff tool. Looked up via
 * `Symbol.for(...)` so cross-bundle / cross-realm checks succeed even when
 * `@gemstack/ai-sdk` is loaded twice (rare, but possible in monorepo + linked
 * setups).
 */
export const HANDOFF_MARKER: unique symbol = Symbol.for('rudderjs.ai.handoff')

/**
 * Internal spec attached to a handoff tool. The agent loop reads this when
 * it sees a tool call that lands on a `HandoffTool` — it does NOT execute
 * the tool's body (there isn't one). Instead it short-circuits the loop,
 * synthesizes a tool result, and pivots control to a new instance of
 * `AgentClass` for the rest of the conversation.
 */
export interface HandoffSpec {
  readonly AgentClass: new (...args: unknown[]) => Agent
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType
}

/**
 * A tool returned by {@link handoff}. The loop recognizes it via the
 * `HANDOFF_MARKER` symbol property and treats it as a control-transfer,
 * not a normal server tool. Its `execute` is intentionally absent.
 */
export interface HandoffTool {
  readonly [HANDOFF_MARKER]: true
  readonly __handoffSpec: HandoffSpec
  readonly definition: ToolDefinitionOptions
  readonly execute?: undefined
  toSchema(): ToolDefinitionSchema
}

/**
 * Options for {@link handoff}. All fields optional — by default, a handoff
 * tool is named `handoffTo${AgentClass.name}` and accepts a single
 * `message: string` argument that becomes the transition prompt seen by
 * the new agent as its first user message.
 */
export interface HandoffOptions<TInput extends z.ZodType = z.ZodType> {
  /** Override the tool name. Default: `handoffTo${AgentClass.name}`. */
  name?: string
  /**
   * Trigger guidance — a short phrase appended to the description so the
   * model knows when to pick this handoff. Example: `'pricing or sales'`
   * → "Hand off the conversation to SalesAgent for pricing or sales."
   */
  when?: string
  /** Override the entire description. If set, takes precedence over `when`. */
  description?: string
  /**
   * Zod schema for the handoff payload. Defaults to
   * `z.object({ message: z.string() })` — the parent's model writes a
   * transition prompt that becomes the child's first user message.
   *
   * Custom schemas are supported but the loop reads `args.message` (string)
   * as the transition prompt. Schemas without a `message` string field will
   * pass an empty transition message; the carried conversation history is
   * still surfaced to the child.
   */
  inputSchema?: TInput
}

const DEFAULT_INPUT_SCHEMA = z.object({
  message: z
    .string()
    .describe('A short user-style prompt for the next agent describing what to do next.'),
})

/**
 * Define a handoff tool — a control-transfer tool the parent agent's model
 * can call to pivot the conversation to another agent. After the model
 * calls it, the parent's loop ends and the child agent runs from the same
 * message history with its own instructions, tools, and model.
 *
 * Distinct from {@link Agent.asTool} (which is call-and-return: the parent
 * resumes after the child finishes and incorporates the child's text as a
 * tool result). Handoffs do not return — the child owns the rest of the
 * conversation.
 *
 * @example
 * ```ts
 * class TriageAgent extends Agent {
 *   tools() {
 *     return [
 *       handoff(SalesAgent,    { when: 'pricing or sales questions' }),
 *       handoff(SupportAgent,  { when: 'bug reports or technical issues' }),
 *     ]
 *   }
 * }
 * ```
 */
export function handoff(
  AgentClass: new (...args: never[]) => Agent,
  opts?: HandoffOptions,
): HandoffTool {
  const name = opts?.name ?? `handoffTo${AgentClass.name}`
  const description = opts?.description ?? buildDefaultDescription(AgentClass.name, opts?.when)
  const inputSchema = (opts?.inputSchema ?? DEFAULT_INPUT_SCHEMA) as z.ZodType

  const spec: HandoffSpec = {
    AgentClass: AgentClass as unknown as new (...args: unknown[]) => Agent,
    name,
    description,
    inputSchema,
  }
  const definition: ToolDefinitionOptions = { name, description, inputSchema }

  const tool: HandoffTool = {
    [HANDOFF_MARKER]: true,
    __handoffSpec: spec,
    definition,
    toSchema(): ToolDefinitionSchema {
      return {
        name,
        description,
        parameters: zodToJsonSchema(inputSchema, 'input'),
      }
    },
  }
  return tool
}

function buildDefaultDescription(agentName: string, when?: string): string {
  const base = `Hand off the conversation to ${agentName}`
  return when ? `${base} for ${when}.` : `${base}.`
}

/**
 * Structural typeguard. Used by the agent loop to detect handoff tools
 * without coupling to a class hierarchy — handoff tools are plain objects
 * tagged with the {@link HANDOFF_MARKER} symbol.
 */
export function isHandoffTool(t: unknown): t is HandoffTool {
  if (t === null || typeof t !== 'object') return false
  const marker = (t as Record<string | symbol, unknown>)[HANDOFF_MARKER]
  return marker === true
}
