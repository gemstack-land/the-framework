/**
 * `WebSearch` provider-tools tests (#B8 Phase 2.x — sidecar).
 *
 * - Factory shape: providerHint, allowed_domains/max_uses lift from
 *   .domains() / .maxResults().
 * - `toAnthropicTools` substitutes the native `web_search_20250305` block
 *   when the providerHint matches.
 * - GoogleAdapter request payload extracts native blocks (`google_search`)
 *   into separate top-level entries alongside any function declarations.
 * - DuckDuckGo `server` execute fallback is preserved (the tool definition
 *   still carries an execute for providers without a native hint match).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { WebSearch, htmlToText } from './provider-tools.js'
import { toAnthropicTools } from './providers/anthropic.js'
import { GoogleAdapter } from './providers/google.js'
import { toolToSchema } from './tool.js'
import type { ToolDefinitionSchema } from './types.js'

// ─── WebSearch factory ────────────────────────────────────

describe('htmlToText — web_fetch content extraction', () => {
  it('drops script + style content, keeps visible text', () => {
    const html = '<html><head><style>body{color:red}</style></head>' +
      '<body>Hello <script>alert(1)</script>world</body></html>'
    assert.equal(htmlToText(html), 'Hello world')
  })

  it('drops script content regardless of whitespace/junk in the end tag', () => {
    // The linear scan finds `</script` then the next `>`, so end-tag variants a
    // regex would miss (`</script >`, `</script\t\n bar>`) all work — the body
    // "x" never leaks as text.
    assert.equal(htmlToText('a<script>x</script >b'), 'ab')
    assert.equal(htmlToText('a<script>x</script\t\n bar>b'), 'ab')
  })

  it('does not hang on adversarial all-"<" input (linear scan, no ReDoS)', () => {
    assert.equal(htmlToText('<'.repeat(50000)), '')
  })

  it('collapses whitespace and is a fixed point', () => {
    const once = htmlToText('<p>one</p>\n\n  <p>two</p>')
    assert.equal(once, 'one two')
    assert.equal(htmlToText(once), once)
  })
})

describe('WebSearch — providerHint cascade', () => {
  it('toTool() carries providerHint with type "web-search"', () => {
    const def = WebSearch.make().toTool()
    assert.equal(def.definition.providerHint?.type, 'web-search')
    // No domain/max_uses lift when not configured.
    assert.equal(def.definition.providerHint?.['allowed_domains'], undefined)
    assert.equal(def.definition.providerHint?.['max_uses'],        undefined)
  })

  it('domains([...]) lifts to providerHint.allowed_domains', () => {
    const def = WebSearch.make().domains(['example.com', 'foo.org']).toTool()
    assert.deepEqual(def.definition.providerHint?.['allowed_domains'], ['example.com', 'foo.org'])
  })

  it('maxResults(n) lifts to providerHint.max_uses', () => {
    const def = WebSearch.make().maxResults(5).toTool()
    assert.equal(def.definition.providerHint?.['max_uses'], 5)
  })

  it('preserves the DuckDuckGo server execute as fallback', () => {
    const def = WebSearch.make().toTool()
    // `.server(...)` chain attaches an execute on the ServerToolBuilder.
    // Adapters without a recognized providerHint will treat WebSearch as a
    // regular function-call tool and call execute on tool calls.
    assert.equal(typeof def.execute, 'function')
  })

  it('schema (via toolToSchema) propagates providerHint for the agent loop', () => {
    const def    = WebSearch.make().domains(['rust-lang.org']).maxResults(3).toTool()
    const schema = toolToSchema(def)
    assert.equal(schema.providerHint?.type, 'web-search')
    assert.deepEqual(schema.providerHint?.['allowed_domains'], ['rust-lang.org'])
    assert.equal(schema.providerHint?.['max_uses'], 3)
  })
})

// ─── Anthropic native block emission ──────────────────────

describe('toAnthropicTools — web_search hint', () => {
  it('emits web_search_20250305 block for the WebSearch hint', () => {
    const def    = WebSearch.make().toTool()
    const schema = toolToSchema(def)
    const blocks = toAnthropicTools([schema]) as Array<Record<string, unknown>>
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0]?.['type'], 'web_search_20250305')
    assert.equal(blocks[0]?.['name'], 'web_search')
    // No optional fields when not configured.
    assert.equal(blocks[0]?.['allowed_domains'], undefined)
    assert.equal(blocks[0]?.['max_uses'],        undefined)
    // Crucially: NOT a function-call shape.
    assert.equal(blocks[0]?.['input_schema'],    undefined)
  })

  it('forwards allowed_domains + max_uses when configured', () => {
    const def    = WebSearch.make().domains(['anthropic.com']).maxResults(7).toTool()
    const schema = toolToSchema(def)
    const blocks = toAnthropicTools([schema]) as Array<Record<string, unknown>>
    assert.deepEqual(blocks[0]?.['allowed_domains'], ['anthropic.com'])
    assert.equal(blocks[0]?.['max_uses'], 7)
  })

  it('honors providerHint.tool override for forward-compat', () => {
    // Apps can pin a future Anthropic web-search variant by overriding the
    // hint's `tool` key. Mirrors the computer-use forward-compat trick.
    const def = WebSearch.make().toTool()
    ;(def.definition.providerHint as Record<string, unknown>)['tool'] = 'web_search_20260101'
    const schema = toolToSchema(def)
    const blocks = toAnthropicTools([schema]) as Array<Record<string, unknown>>
    assert.equal(blocks[0]?.['type'], 'web_search_20260101')
  })

  it('non-web-search tools still emit standard function-call shape', () => {
    const schema: ToolDefinitionSchema = {
      name:        'lookup',
      description: 'Look up a thing.',
      parameters:  { type: 'object', properties: { id: { type: 'string' } } },
    }
    const blocks = toAnthropicTools([schema]) as Array<Record<string, unknown>>
    assert.equal(blocks[0]?.['name'], 'lookup')
    assert.equal(blocks[0]?.['description'], 'Look up a thing.')
    assert.deepEqual(blocks[0]?.['input_schema'], { type: 'object', properties: { id: { type: 'string' } } })
  })
})

// ─── Gemini native block emission ─────────────────────────

describe('GoogleAdapter — google_search hint via tools array', () => {
  // Stub the Gemini SDK client so no dynamic SDK import (or network call) runs.
  function adapter(): { adapter: GoogleAdapter; captured: () => Record<string, unknown> | undefined } {
    const a = new GoogleAdapter({ apiKey: 'sk-test' }, 'gemini-2.5-pro')
    let captured: Record<string, unknown> | undefined
    ;(a as unknown as { getClient: { set(c: unknown): void } }).getClient.set({
      models: {
        generateContent: async (payload: Record<string, unknown>) => {
          captured = payload
          return { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }
        },
      },
    })
    return { adapter: a, captured: () => captured }
  }

  it('emits { google_search: {} } as a separate top-level tools entry', async () => {
    const { adapter: a, captured } = adapter()
    const def    = WebSearch.make().toTool()
    const schema = toolToSchema(def)
    await a.generate({
      model:    'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }],
      tools:    [schema],
    })
    const tools = ((captured()?.['config'] as Record<string, unknown>)?.['tools']) as unknown[]
    assert.ok(Array.isArray(tools), 'tools array set on config')
    // No functionDeclarations entry when the only tool is a native one.
    assert.equal(tools.length, 1)
    assert.deepEqual(tools[0], { google_search: {} })
  })

  it('mixes function declarations + native blocks (decls first)', async () => {
    const { adapter: a, captured } = adapter()
    const websearch = toolToSchema(WebSearch.make().toTool())
    const fn: ToolDefinitionSchema = {
      name:        'lookup_user',
      description: 'Look up a user by id.',
      parameters:  { type: 'object', properties: { id: { type: 'string' } } },
    }
    await a.generate({
      model:    'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }],
      tools:    [websearch, fn],
    })
    const tools = ((captured()?.['config'] as Record<string, unknown>)?.['tools']) as Array<Record<string, unknown>>
    assert.equal(tools.length, 2)
    // Function declarations come first (toGeminiTools.unshift contract).
    assert.ok(tools[0]?.['functionDeclarations'], 'functionDeclarations entry first')
    const decls = tools[0]['functionDeclarations'] as Array<Record<string, unknown>>
    assert.equal(decls.length, 1)
    assert.equal(decls[0]?.['name'], 'lookup_user')
    assert.deepEqual(tools[1], { google_search: {} })
  })

  it('plain function-call tool still wraps into one functionDeclarations entry', async () => {
    const { adapter: a, captured } = adapter()
    const fn: ToolDefinitionSchema = {
      name:        'noop',
      description: 'noop',
      parameters:  { type: 'object' },
    }
    await a.generate({
      model:    'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }],
      tools:    [fn],
    })
    const tools = ((captured()?.['config'] as Record<string, unknown>)?.['tools']) as Array<Record<string, unknown>>
    assert.equal(tools.length, 1)
    assert.ok(tools[0]?.['functionDeclarations'])
  })
})
