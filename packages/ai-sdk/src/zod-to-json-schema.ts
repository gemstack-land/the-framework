import { z } from 'zod'

/** Request (tool parameters) vs response (structured output) projection. */
export type SchemaIo = 'input' | 'output'

/**
 * Zod → JSON Schema for tool/output definitions.
 *
 * Uses Zod 4's native `z.toJSONSchema` directly (Zod is a hard dependency), so
 * the package carries no framework coupling for schema conversion. Strips the
 * `$schema` dialect key (provider tool/output schemas don't want it) and falls
 * back to an open object schema when a schema can't be represented, so
 * tool/output definitions always have *some* parameter shape.
 *
 * `io` selects the request (`'input'`, tool parameters) vs response
 * (`'output'`, structured output) projection; defaults to `'output'`.
 */
export function zodToJsonSchema(schema: z.ZodType, io: SchemaIo = 'output'): Record<string, unknown> {
  try {
    const out = z.toJSONSchema(schema, { io }) as Record<string, unknown>
    delete out.$schema
    return out
  } catch {
    return { type: 'object' }
  }
}
