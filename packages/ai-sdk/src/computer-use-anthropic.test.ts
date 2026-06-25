import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { toAnthropicMessages, toAnthropicTools } from './providers/anthropic.js'
import type { AiMessage, ToolDefinitionSchema } from './types.js'

// ─── toAnthropicTools — provider hint substitution ────────

describe('toAnthropicTools — providerHint: computer-use', () => {
  it('emits Anthropic native computer_20250124 block (default variant + viewport)', () => {
    const tools: ToolDefinitionSchema[] = [{
      name:        'computer',
      description: 'drive the browser',
      parameters:  { type: 'object', properties: {} },
      providerHint: {
        type:              'computer-use',
        tool:              'computer_20250124',
        display_width_px:  1280,
        display_height_px: 800,
      },
    }]

    const out = toAnthropicTools(tools)

    assert.deepEqual(out, [{
      type:              'computer_20250124',
      name:              'computer',
      display_width_px:  1280,
      display_height_px: 800,
    }])
  })

  it('honors a custom viewport from the hint', () => {
    const tools: ToolDefinitionSchema[] = [{
      name:        'computer',
      description: 'drive the browser',
      parameters:  {},
      providerHint: {
        type:              'computer-use',
        tool:              'computer_20250124',
        display_width_px:  1920,
        display_height_px: 1080,
      },
    }]

    const out = toAnthropicTools(tools) as Array<{ display_width_px: number; display_height_px: number }>
    assert.equal(out[0]!.display_width_px,  1920)
    assert.equal(out[0]!.display_height_px, 1080)
  })

  it('falls back to defaults when hint omits viewport fields', () => {
    const tools: ToolDefinitionSchema[] = [{
      name:        'computer',
      description: 'drive the browser',
      parameters:  {},
      providerHint: { type: 'computer-use' },
    }]

    const out = toAnthropicTools(tools) as Array<{ type: string; display_width_px: number; display_height_px: number }>
    assert.equal(out[0]!.type,              'computer_20250124')
    assert.equal(out[0]!.display_width_px,  1280)
    assert.equal(out[0]!.display_height_px, 800)
  })

  it('forwards a custom tool variant from the hint (forward-compat for computer_20260101 etc)', () => {
    const tools: ToolDefinitionSchema[] = [{
      name:        'computer',
      description: 'drive the browser',
      parameters:  {},
      providerHint: {
        type:              'computer-use',
        tool:              'computer_20260101',  // hypothetical future schema
        display_width_px:  800,
        display_height_px: 600,
      },
    }]

    const out = toAnthropicTools(tools) as Array<{ type: string }>
    assert.equal(out[0]!.type, 'computer_20260101')
  })

  it('passes through standard tools unchanged when no providerHint', () => {
    const tools: ToolDefinitionSchema[] = [{
      name:        'get_weather',
      description: 'fetch the current weather',
      parameters:  { type: 'object', properties: { city: { type: 'string' } } },
    }]

    const out = toAnthropicTools(tools)
    assert.deepEqual(out, [{
      name:         'get_weather',
      description:  'fetch the current weather',
      input_schema: { type: 'object', properties: { city: { type: 'string' } } },
    }])
  })

  it('mixes computer-use + standard tools in one call (each routed correctly)', () => {
    const tools: ToolDefinitionSchema[] = [
      {
        name:        'computer',
        description: 'drive the browser',
        parameters:  {},
        providerHint: {
          type:              'computer-use',
          tool:              'computer_20250124',
          display_width_px:  1280,
          display_height_px: 800,
        },
      },
      {
        name:        'get_weather',
        description: 'weather',
        parameters:  { type: 'object' },
      },
    ]

    const out = toAnthropicTools(tools) as Array<{ type?: string; name: string; input_schema?: unknown }>
    assert.equal(out[0]!.type, 'computer_20250124')
    assert.equal(out[0]!.name, 'computer')
    assert.equal(out[1]!.name, 'get_weather')
    assert.ok(out[1]!.input_schema, 'standard tool keeps input_schema')
    assert.equal((out[1] as { type?: string }).type, undefined, 'standard tool has no native `type`')
  })

  it('ignores unknown providerHint types — falls back to standard serialization', () => {
    const tools: ToolDefinitionSchema[] = [{
      name:        'experimental',
      description: 'something',
      parameters:  { type: 'object' },
      providerHint: { type: 'some-unknown-hint-type' },
    }]

    const out = toAnthropicTools(tools) as Array<{ name: string; input_schema?: unknown; type?: string }>
    assert.equal(out[0]!.name,          'experimental')
    assert.ok(out[0]!.input_schema,    'unknown hint falls back to standard shape')
    assert.equal(out[0]!.type, undefined)
  })
})

// ─── toAnthropicMessages — tool-result content shapes ─────

describe('toAnthropicMessages — tool message content', () => {
  it('passes through string content unchanged', () => {
    const messages: AiMessage[] = [{
      role:       'tool',
      toolCallId: 'tc-1',
      content:    'plain text result',
    }]

    const out = toAnthropicMessages(messages) as Array<{ role: string; content: Array<{ type: string; tool_use_id: string; content: unknown }> }>

    assert.equal(out[0]!.role,                     'user')
    assert.equal(out[0]!.content[0]!.type,         'tool_result')
    assert.equal(out[0]!.content[0]!.tool_use_id,  'tc-1')
    assert.equal(out[0]!.content[0]!.content,      'plain text result')
  })

  it('expands ContentPart[] (image) into Anthropic image block — the computer-use screenshot path', () => {
    const messages: AiMessage[] = [{
      role:       'tool',
      toolCallId: 'tc-2',
      content:    [
        { type: 'image', mimeType: 'image/png', data: 'iVBORw0KG' },
      ],
    }]

    const out = toAnthropicMessages(messages) as Array<{ role: string; content: Array<{ type: string; tool_use_id: string; content: unknown }> }>

    assert.deepEqual(out[0]!.content[0]!.content, [
      {
        type:   'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KG' },
      },
    ])
  })

  it('expands a mixed ContentPart[] (text + image) into the right Anthropic shape', () => {
    const messages: AiMessage[] = [{
      role:       'tool',
      toolCallId: 'tc-3',
      content:    [
        { type: 'text',  text: 'before screenshot:' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ],
    }]

    const out = toAnthropicMessages(messages) as Array<{ content: Array<{ content: unknown }> }>
    const inner = out[0]!.content[0]!.content as Array<{ type: string }>
    assert.equal(inner.length,    2)
    assert.equal(inner[0]!.type, 'text')
    assert.equal(inner[1]!.type, 'image')
  })

  it('JSON-stringifies a non-string, non-array tool result (legacy fallback)', () => {
    const messages: AiMessage[] = [{
      role:       'tool',
      toolCallId: 'tc-4',
      content:    { items: [1, 2, 3], status: 'ok' } as unknown as string,
    }]

    const out = toAnthropicMessages(messages) as Array<{ content: Array<{ content: string }> }>
    assert.equal(out[0]!.content[0]!.content, JSON.stringify({ items: [1, 2, 3], status: 'ok' }))
  })

  it('non-tool messages (assistant with text) are unaffected', () => {
    const messages: AiMessage[] = [{
      role:    'assistant',
      content: 'hello world',
    }]

    const out = toAnthropicMessages(messages) as Array<{ role: string; content: unknown }>
    assert.equal(out[0]!.role,    'assistant')
    assert.equal(out[0]!.content, 'hello world')
  })
})
