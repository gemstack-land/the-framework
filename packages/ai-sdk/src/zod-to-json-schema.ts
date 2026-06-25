import type { z } from 'zod'
import { convertSchema, type SchemaIo } from '@rudderjs/json-schema'

/**
 * Zod → JSON Schema for tool/output definitions.
 *
 * Delegates to the framework's shared, validator-agnostic converter
 * (`@rudderjs/json-schema`), which dispatches on the Standard Schema vendor tag
 * and uses Zod 4's native `z.toJSONSchema` — the same converter `@rudderjs/openapi`
 * uses. Falls back to an open object schema when the converter can't represent
 * the schema, so tool/output definitions always have *some* parameter shape.
 *
 * `io` selects the request (`'input'` — tool parameters) vs response
 * (`'output'` — structured output) projection; defaults to `'output'`.
 */
export function zodToJsonSchema(schema: z.ZodType, io: SchemaIo = 'output'): Record<string, unknown> {
  return convertSchema(schema, io) ?? { type: 'object' }
}
