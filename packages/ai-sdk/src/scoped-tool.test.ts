import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { scopedTool, capability, flattenCapabilities, ScopedToolError } from './scoped-tool.js'
import { toolToSchema } from './tool.js'
import type { ToolCallContext } from './types.js'

/** Drive a scoped tool's dispatch generator to completion, collecting yields. */
async function run(
  tool: { execute?: (input: Record<string, unknown>, ctx?: ToolCallContext) => unknown },
  input: Record<string, unknown>,
): Promise<{ result: unknown; updates: unknown[] }> {
  const gen = tool.execute!(input) as AsyncGenerator<unknown, unknown, void>
  const updates: unknown[] = []
  while (true) {
    const step = await gen.next()
    if (step.done) return { result: step.value, updates }
    updates.push(step.value)
  }
}

const search = () =>
  scopedTool({
    name: 'search',
    description: 'Run a search across one of several engines.',
    capabilities: {
      web: capability({
        description: 'Web results',
        input: z.object({ query: z.string(), page: z.number().optional() }),
        handler: async ({ query }) => ({ engine: 'web', query }),
      }),
      images: capability({
        description: 'Image results',
        input: z.object({ query: z.string(), safe: z.boolean() }),
        handler: async ({ query, safe }) => ({ engine: 'images', query, safe }),
      }),
    },
  })

describe('scopedTool — flattened schema', () => {
  it('collapses the union into one flat object with a discriminator enum', () => {
    const schema = toolToSchema(search())
    assert.equal(schema.name, 'search')
    const params = schema.parameters as {
      type: string
      properties: Record<string, { type?: string; enum?: string[] }>
      required: string[]
    }
    assert.equal(params.type, 'object')
    // discriminator + the merged union of every branch's fields
    assert.deepEqual(
      new Set(Object.keys(params.properties)),
      new Set(['sub_tool', 'query', 'page', 'safe']),
    )
    assert.equal(params.properties['sub_tool']!.type, 'string')
    assert.deepEqual(params.properties['sub_tool']!.enum, ['web', 'images'])
  })

  it('top-level required = discriminator + fields required by EVERY branch', () => {
    const plan = flattenCapabilities({
      web: capability({ input: z.object({ query: z.string(), page: z.number().optional() }), handler: async () => 1 }),
      images: capability({ input: z.object({ query: z.string(), safe: z.boolean() }), handler: async () => 2 }),
    })
    // `query` is required in both; `safe` only in images; `page` optional everywhere.
    assert.deepEqual(plan.required, ['sub_tool', 'query'])
    assert.deepEqual(plan.requiredByCapability['images'], ['query', 'safe'])
  })

  it('annotates non-universal fields with their owning capabilities', () => {
    const params = toolToSchema(search()).parameters as {
      properties: Record<string, { description?: string }>
    }
    assert.match(params.properties['safe']!.description ?? '', /Only for sub_tool: images/)
    // `query` is universal — no owner note appended.
    assert.doesNotMatch(params.properties['query']!.description ?? '', /Only for sub_tool/)
  })
})

describe('scopedTool — dispatch + validation', () => {
  it('routes to the chosen capability handler', async () => {
    const { result } = await run(search(), { sub_tool: 'web', query: 'rudder' })
    assert.deepEqual(result, { engine: 'web', query: 'rudder' })
  })

  it('enforces the chosen branch required fields before the handler runs', async () => {
    // `safe` is required by the images branch but absent.
    await assert.rejects(
      () => run(search(), { sub_tool: 'images', query: 'cats' }),
      (err: Error) => err instanceof ScopedToolError && /Invalid arguments.*images.*safe/s.test(err.message),
    )
  })

  it('rejects a missing discriminator', async () => {
    await assert.rejects(
      () => run(search(), { query: 'x' }),
      (err: Error) => err instanceof ScopedToolError && /Missing or non-string "sub_tool"/.test(err.message),
    )
  })

  it('rejects an unknown discriminator value', async () => {
    await assert.rejects(
      () => run(search(), { sub_tool: 'videos', query: 'x' }),
      (err: Error) => err instanceof ScopedToolError && /Unknown sub_tool "videos"/.test(err.message),
    )
  })
})

describe('scopedTool — allowlist', () => {
  const gated = () =>
    scopedTool({
      name: 'search',
      description: 'gated',
      allow: ['web'],
      capabilities: {
        web: capability({ input: z.object({ query: z.string() }), handler: async () => 'web' }),
        images: capability({ input: z.object({ query: z.string() }), handler: async () => 'images' }),
      },
    })

  it('narrows the discriminator enum to the allowed subset', () => {
    const params = toolToSchema(gated()).parameters as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(params.properties['sub_tool']!.enum, ['web'])
  })

  it('rejects a disabled-but-declared capability at runtime', async () => {
    await assert.rejects(
      () => run(gated(), { sub_tool: 'images', query: 'x' }),
      (err: Error) => err instanceof ScopedToolError && /Unknown sub_tool "images"/.test(err.message),
    )
  })

  it('throws at build time if allow references an undeclared capability', () => {
    assert.throws(
      () =>
        scopedTool({
          name: 't',
          description: 'd',
          allow: ['nope'],
          capabilities: { web: capability({ input: z.object({}), handler: async () => 1 }) },
        }),
      ScopedToolError,
    )
  })
})

describe('scopedTool — custom discriminator + streaming branch', () => {
  it('honors a custom discriminator field name', () => {
    const tool = scopedTool({
      name: 'op',
      description: 'd',
      discriminator: 'action',
      capabilities: { ping: capability({ input: z.object({}), handler: async () => 'pong' }) },
    })
    const params = toolToSchema(tool).parameters as { required: string[]; properties: Record<string, unknown> }
    assert.ok(params.required.includes('action'))
    assert.ok('action' in params.properties)
  })

  it('forwards tool-update yields from an async-generator branch handler', async () => {
    const tool = scopedTool({
      name: 'stream',
      description: 'd',
      capabilities: {
        go: capability({
          input: z.object({ n: z.number() }),
          handler: async function* ({ n }) {
            for (let i = 0; i < n; i++) yield { progress: i }
            return { done: n }
          },
        }),
      },
    })
    const { result, updates } = await run(tool, { sub_tool: 'go', n: 3 })
    assert.deepEqual(updates, [{ progress: 0 }, { progress: 1 }, { progress: 2 }])
    assert.deepEqual(result, { done: 3 })
  })
})
