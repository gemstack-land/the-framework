import { toKebabCase } from './utils.js'
import { getDescription } from './decorators.js'
import type { ZodLikeObject } from './types.js'

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: string
}

export abstract class McpPrompt {
  /** Prompt name */
  name(): string {
    return toKebabCase(this.constructor.name.replace(/Prompt$/, ''))
  }

  /** Description */
  description(): string {
    return getDescription(this.constructor) ?? ''
  }

  /** Arguments schema — a Zod object (v3 or v4). */
  arguments?(): ZodLikeObject

  /**
   * Generate prompt messages. Extra parameters beyond `args` are resolved
   * from the DI container when the method is decorated with `@Handle()`.
   */
  abstract handle(args: Record<string, unknown>, ...deps: unknown[]): Promise<McpPromptMessage[]>

  /**
   * Optional hook controlling whether this prompt is exposed to clients.
   *
   * Returning `false` hides the prompt from `prompts/list` AND causes
   * `prompts/get` to throw "Unknown prompt" — preventing bypass.
   */
  shouldRegister?(): boolean | Promise<boolean>
}
