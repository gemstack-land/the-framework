import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { toolDefinition, toolToSchema, dynamicTool } from './tool.js'

describe('jsonSchema passthrough', () => {
  it('toolDefinition().toSchema() prefers jsonSchema over the zod fallback', () => {
    const customSchema = {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name from the MCP server' },
      },
      required: ['location'],
      additionalProperties: false,
    }

    const tool = toolDefinition({
      name: 'remote_weather',
      description: 'Mirror of an MCP tool',
      inputSchema: z.unknown(),  // placeholder; the real shape lives in jsonSchema
      jsonSchema: customSchema,
    })

    const schema = tool.toSchema()
    assert.deepStrictEqual(schema.parameters, customSchema)
  })

  it('toolToSchema() prefers jsonSchema over the zod fallback', () => {
    const customSchema = { type: 'object', properties: {} as Record<string, unknown>, required: [] as string[] }
    const tool = dynamicTool({
      name: 'x',
      description: '',
      inputSchema: z.object({ ignored: z.string() }),
      jsonSchema: customSchema,
    })

    const schema = toolToSchema(tool)
    assert.deepStrictEqual(schema.parameters, customSchema)
  })

  it('falls back to zod when jsonSchema is omitted', () => {
    const tool = toolDefinition({
      name: 'classic',
      description: '',
      inputSchema: z.object({ q: z.string() }),
    })
    const schema = tool.toSchema()
    assert.strictEqual((schema.parameters as Record<string, unknown>)['type'], 'object')
    assert.ok((schema.parameters as { properties: Record<string, unknown> }).properties['q'])
  })

  it('jsonSchema survives onto a server-attached tool', () => {
    const customSchema = { type: 'object', properties: {} as Record<string, unknown> }
    const tool = toolDefinition({
      name: 'srv',
      description: '',
      inputSchema: z.unknown(),
      jsonSchema: customSchema,
    }).server(async () => 'ok')

    assert.deepStrictEqual(toolToSchema(tool).parameters, customSchema)
  })
})
