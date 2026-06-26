import { z } from 'zod'
import type { ZodLikeObject } from './types.js'

/**
 * Zod → JSON Schema for MCP tool/prompt input + output schemas.
 *
 * Uses Zod 4's native `z.toJSONSchema()` directly (Zod is a hard dependency), so
 * the package carries no framework coupling for schema conversion. MCP
 * tool/prompt parameters are request inputs, so we convert with `io: 'input'`.
 *
 * - `unrepresentable: 'any'` keeps types with no JSON Schema analogue (`z.date()`,
 *   `z.bigint()`) from throwing — they degrade to an open `{}` instead of crashing
 *   the document.
 * - The `override` then upgrades `z.date()` → `{ type: 'string', format: 'date-time' }`
 *   (a date serializes to an ISO string on the wire). `z.bigint()` stays open — no
 *   single safe JSON representation, so we don't guess.
 * - The per-schema `$schema` dialect marker is stripped (tool/prompt schemas don't
 *   want it).
 *
 * Falls back to an open object schema (`{ type: 'object' }`) when the input can't
 * be converted (e.g. a non-Zod `{ shape }`), so a tool always advertises *some*
 * input shape.
 */
export function zodToJsonSchema(schema: ZodLikeObject): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema as unknown as z.ZodType, {
      io: 'input',
      unrepresentable: 'any',
      override: (ctx) => {
        if (ctx.zodSchema?._zod?.def?.type === 'date') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.format = 'date-time'
        }
      },
    }) as Record<string, unknown>
    delete json['$schema']
    return json
  } catch {
    return { type: 'object' }
  }
}
