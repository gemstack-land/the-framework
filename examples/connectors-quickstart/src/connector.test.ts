import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountConnectors } from '@gemstack/mcp-connectors'
import { McpTestClient } from '@gemstack/mcp/testing'
import type { McpToolResult } from '@gemstack/mcp'
import library from './library-connector.js'

const client = new McpTestClient(mountConnectors([library]))

function txt(result: McpToolResult): string {
  const first = result.content[0]
  return first && first.type === 'text' ? first.text : ''
}

test('reference connector exposes its tools, namespaced', async () => {
  const names = (await client.listTools()).map((t) => t.name).sort()
  assert.deepEqual(names, ['library_get-book', 'library_list-books', 'library_search-books'])
})

test('search-books filters by title substring', async () => {
  const res = await client.callTool('library_search-books', { query: 'design' })
  const body = txt(res)
  assert.match(body, /Domain-Driven Design/)
  assert.doesNotMatch(body, /Refactoring/)
})

test('get-book returns one book by id', async () => {
  const res = await client.callTool('library_get-book', { id: 'b1' })
  assert.match(txt(res), /Pragmatic/)
})
