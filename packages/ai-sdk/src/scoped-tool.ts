import { z } from 'zod'
import { ServerToolBuilder } from './tool.js'
import { isAsyncGenerator } from './tool-helpers.js'
import { zodToJsonSchema } from './zod-to-json-schema.js'
import type { ToolCallContext, ToolDefinitionOptions, ToolNeedsApproval } from './types.js'

/**
 * One capability branch of a scoped tool: a named sub-tool with its own
 * input shape + handler. Authored either inline in {@link scopedTool}'s
 * `capabilities` map or via the {@link capability} helper (which preserves
 * per-branch input inference for the handler signature).
 */
export interface ScopedCapability<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
  TUpdate = unknown,
> {
  /** Optional per-capability description, surfaced in the discriminator enum note. */
  description?: string
  /** This branch's input schema. Validated in code before the handler runs. */
  input: TInput
  /**
   * Branch handler. May be a plain async function (single return value) or
   * an `async function*` (yields `tool-update` chunks, returns the result) —
   * the same dual protocol `ToolBuilder.server` accepts.
   */
  handler: (
    input: z.infer<TInput>,
    ctx?: ToolCallContext,
  ) => TOutput | Promise<TOutput> | AsyncGenerator<TUpdate, TOutput, void>
}

/**
 * Identity helper that infers a capability's input type at the definition
 * site, so its `handler` parameter is typed without an explicit annotation.
 *
 * @example
 * const web = capability({
 *   input: z.object({ query: z.string() }),
 *   handler: async ({ query }) => search(query), // `query` is `string`
 * })
 */
export function capability<TInput extends z.ZodType, TOutput, TUpdate = unknown>(
  spec: ScopedCapability<TInput, TOutput, TUpdate>,
): ScopedCapability<TInput, TOutput, TUpdate> {
  return spec
}

export interface ScopedToolOptions {
  name: string
  description: string
  /** Discriminator field name added to the flat schema. Default `'sub_tool'`. */
  discriminator?: string
  /** Named capability branches. Keys become the discriminator enum values. */
  capabilities: Record<string, ScopedCapability>
  /**
   * Runtime allowlist — restrict callable capabilities to a subset of
   * `capabilities` keys (e.g. per-plan gating). Both the discriminator enum
   * and the runtime dispatch honor it. Defaults to every capability key.
   * Entries not present in `capabilities` throw at build time.
   */
  allow?: string[]
  /** Forwarded to the generated tool definition. */
  needsApproval?: ToolNeedsApproval | undefined
}

/**
 * The shared flattening plan, computed once so the JSON-Schema render and the
 * runtime dispatch/validation cannot drift. Exported for adapters and tests.
 */
export interface FlatPlan {
  discriminator: string
  /** Allowed discriminator values, in declaration order. */
  values: string[]
  /** Merged JSON-Schema properties (discriminator included). */
  properties: Record<string, unknown>
  /** Top-level required = discriminator + fields required by EVERY branch. */
  required: string[]
  /** Per-capability required field names, for in-code validation before dispatch. */
  requiredByCapability: Record<string, string[]>
  /** For each non-discriminator field, which capabilities reference it. */
  owners: Record<string, string[]>
}

/** Error thrown by a scoped tool's dispatch before any handler runs. */
export class ScopedToolError extends Error {
  override readonly name = 'ScopedToolError'
  constructor(message: string) {
    super(message)
  }
}

function jsonSchemaFor(schema: z.ZodType): { properties: Record<string, unknown>; required: string[] } {
  const json = zodToJsonSchema(schema, 'input') as {
    properties?: Record<string, unknown>
    required?: unknown
  }
  const properties = (json.properties && typeof json.properties === 'object') ? json.properties : {}
  const required = Array.isArray(json.required) ? json.required.filter((r): r is string => typeof r === 'string') : []
  return { properties, required }
}

/**
 * Collapse N capability branches into one flat function-call plan with a
 * discriminator enum. Function-calling APIs do not reliably honor a top-level
 * `oneOf`, so a discriminated union must flatten to a single object schema:
 * the union of all branches' fields, a top-level `required` containing only
 * fields required by EVERY branch, and per-branch requireds enforced in code.
 */
export function flattenCapabilities(
  capabilities: Record<string, ScopedCapability>,
  discriminator = 'sub_tool',
  allow?: string[],
): FlatPlan {
  const keys = Object.keys(capabilities)
  if (keys.length === 0) {
    throw new ScopedToolError('A scoped tool needs at least one capability.')
  }

  const values = allow ?? keys
  for (const v of values) {
    if (!(v in capabilities)) {
      throw new ScopedToolError(`allow lists "${v}", which is not a declared capability.`)
    }
  }
  if (values.length === 0) {
    throw new ScopedToolError('A scoped tool needs at least one allowed capability.')
  }

  const properties: Record<string, unknown> = {}
  const owners: Record<string, string[]> = {}
  const requiredByCapability: Record<string, string[]> = {}
  // A field is top-level required iff every allowed branch requires it. Seed
  // with the first branch's requireds, then intersect down across the rest.
  let requiredByAll: string[] | null = null

  for (const key of values) {
    if (key === discriminator) {
      throw new ScopedToolError(`Capability "${key}" collides with the discriminator field name "${discriminator}".`)
    }
    const { properties: props, required } = jsonSchemaFor(capabilities[key]!.input)
    requiredByCapability[key] = required

    for (const [field, schema] of Object.entries(props)) {
      if (field === discriminator) {
        throw new ScopedToolError(`Capability "${key}" declares a field named "${discriminator}", which collides with the discriminator.`)
      }
      // First branch to declare a field owns its schema; later branches must
      // share the field name (the model fills one flat object), so we keep the
      // first shape and just record co-ownership for the field's note.
      if (!(field in properties)) properties[field] = schema
      ;(owners[field] ??= []).push(key)
    }

    requiredByAll = requiredByAll === null
      ? [...required]
      : requiredByAll.filter(f => required.includes(f))
  }

  // Annotate each non-universal field with the capabilities that use it, so
  // the model knows a field only applies to certain discriminator values.
  for (const [field, ownerKeys] of Object.entries(owners)) {
    if (ownerKeys.length === values.length) continue // universal — no note
    const note = `Only for ${discriminator}: ${ownerKeys.join(', ')}.`
    const schema = properties[field]
    if (schema && typeof schema === 'object') {
      const s = schema as { description?: unknown }
      s.description = typeof s.description === 'string' && s.description.length > 0
        ? `${s.description} ${note}`
        : note
    }
  }

  const descParts = values.map(k => {
    const d = capabilities[k]!.description
    return d ? `"${k}" (${d})` : `"${k}"`
  })
  properties[discriminator] = {
    type: 'string',
    enum: values,
    description: `Which capability to invoke. One of: ${descParts.join(', ')}.`,
  }

  return {
    discriminator,
    values,
    properties,
    required: [discriminator, ...(requiredByAll ?? [])],
    requiredByCapability,
    owners,
  }
}

/**
 * Build a single function-call tool from a discriminated union of capability
 * branches. The branches collapse into one flat schema with a discriminator
 * enum (see {@link flattenCapabilities}); at call time the dispatch validates
 * the discriminator against the allowlist, validates the chosen branch's input
 * (enforcing its required fields), and runs that branch's handler.
 *
 * @example
 * const search = scopedTool({
 *   name: 'search',
 *   description: 'Run a search across one of several engines.',
 *   capabilities: {
 *     web:    capability({ input: z.object({ query: z.string() }),               handler: webSearch }),
 *     images: capability({ input: z.object({ query: z.string(), safe: z.boolean() }), handler: imageSearch }),
 *   },
 * })
 */
export function scopedTool(options: ScopedToolOptions): ServerToolBuilder<Record<string, unknown>, unknown> {
  const discriminator = options.discriminator ?? 'sub_tool'
  const plan = flattenCapabilities(options.capabilities, discriminator, options.allow)
  const allowed = new Set(plan.values)

  const jsonSchema: Record<string, unknown> = {
    type: 'object',
    properties: plan.properties,
    required: plan.required,
  }

  const definition: ToolDefinitionOptions = {
    name: options.name,
    description: options.description,
    // Placeholder — the wire schema is `jsonSchema`; the loop's arg validation
    // passes the raw object through and our dispatch does per-branch checks.
    inputSchema: z.unknown() as unknown as z.ZodType,
    jsonSchema,
    ...(options.needsApproval !== undefined ? { needsApproval: options.needsApproval } : {}),
  }

  async function* dispatch(input: Record<string, unknown>, ctx?: ToolCallContext): AsyncGenerator<unknown, unknown, void> {
    const raw = (input && typeof input === 'object') ? input : {}
    const which = raw[discriminator]

    if (typeof which !== 'string') {
      throw new ScopedToolError(`Missing or non-string "${discriminator}". Expected one of: ${plan.values.join(', ')}.`)
    }
    if (!allowed.has(which)) {
      throw new ScopedToolError(`Unknown ${discriminator} "${which}". Expected one of: ${plan.values.join(', ')}.`)
    }

    const branch = options.capabilities[which]!
    // Strip the discriminator before validating against the branch's schema —
    // the branch never declares it, and a strict schema would reject it.
    const { [discriminator]: _omit, ...branchInput } = raw
    const parsed = branch.input.safeParse(branchInput)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      throw new ScopedToolError(`Invalid arguments for ${discriminator} "${which}": ${issues}`)
    }

    const result = branch.handler(parsed.data, ctx)
    if (isAsyncGenerator(result)) {
      return yield* result
    }
    return await result
  }

  return new ServerToolBuilder<Record<string, unknown>, unknown>(definition, dispatch)
}
