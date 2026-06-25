import { z } from 'zod'
import { zodToJsonSchema } from './zod-to-json-schema.js'

export interface OutputWrapper<T = unknown> {
  type: 'object' | 'array' | 'choice'
  schema: z.ZodType<T>
  parse(text: string): T
  toSystemPrompt(): string
}

export class Output {
  /** Structured object output with Zod schema */
  static object<T extends z.ZodRawShape>(opts: { schema: z.ZodObject<T> }): OutputWrapper<z.infer<z.ZodObject<T>>> {
    return {
      type: 'object',
      schema: opts.schema,
      parse(text: string) {
        const json = extractJson(text)
        return opts.schema.parse(json)
      },
      toSystemPrompt() {
        return `Respond with a JSON object matching this schema. Output ONLY valid JSON, no markdown fences.\n${JSON.stringify(zodToJsonSchema(opts.schema), null, 2)}`
      },
    }
  }

  /** Structured array output — each element validated by schema */
  static array<T extends z.ZodType>(opts: { element: T }): OutputWrapper<z.infer<T>[]> {
    const arraySchema = z.array(opts.element)
    return {
      type: 'array',
      schema: arraySchema as z.ZodType<z.infer<T>[]>,
      parse(text: string) {
        const json = extractJson(text)
        return arraySchema.parse(json)
      },
      toSystemPrompt() {
        return `Respond with a JSON array where each element matches this schema. Output ONLY valid JSON.\n${JSON.stringify(zodToJsonSchema(opts.element), null, 2)}`
      },
    }
  }

  /** Classification — pick one of the provided options */
  static choice<T extends string>(opts: { options: readonly [T, ...T[]] }): OutputWrapper<T> {
    const enumSchema = z.enum(opts.options)
    return {
      type: 'choice',
      schema: enumSchema as z.ZodType<T>,
      parse(text: string) {
        return enumSchema.parse(text.trim()) as T
      },
      toSystemPrompt() {
        return `Respond with exactly one of these options: ${opts.options.join(', ')}. Output ONLY the option, nothing else.`
      },
    }
  }
}

function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim()
  try {
    return JSON.parse(stripped)
  } catch (err) {
    throw new Error(
      `[Rudder AI] Failed to parse JSON from model output: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}
