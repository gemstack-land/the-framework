import 'reflect-metadata'
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { McpTestClient } from '@gemstack/mcp/testing'
import type { McpToolResult } from '@gemstack/mcp'
import { mountConnectors } from '@gemstack/connectors'
import drive from './index.js'

const realFetch = globalThis.fetch

interface Captured {
  url: string
  method: string
  body?: unknown
}
let calls: Captured[] = []

/** Install a fetch stub. `handler` maps a request to `{ status?, body }`. */
function mockFetch(handler: (url: string, method: string) => { status?: number; body: unknown }) {
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const { status = 200, body } = handler(String(url), method)
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }) as unknown as typeof fetch
}

function client(token: string | undefined = 'tok') {
  return new McpTestClient(mountConnectors([drive], { credentials: () => ({ token }) }))
}

function json(result: McpToolResult): any {
  const first = result.content[0]
  return first && first.type === 'text' ? JSON.parse(first.text) : undefined
}

/** Decode a captured request URL, restoring `+`-encoded spaces for readable matching. */
function urlOf(i: number): string {
  return decodeURIComponent(calls[i]!.url).replace(/\+/g, ' ')
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  globalThis.fetch = realFetch
})

test('tools are namespaced and writes are not marked read-only', async () => {
  const tools = await client().listTools()
  const names = tools.map((t) => t.name).sort()
  assert.ok(names.includes('google-drive_list-files'))
  assert.ok(names.includes('google-drive_create-folder'))
  assert.equal(tools.length, 9)
  const read = tools.find((t) => t.name === 'google-drive_get-file')
  const write = tools.find((t) => t.name === 'google-drive_create-folder')
  const trash = tools.find((t) => t.name === 'google-drive_trash-file')
  assert.equal(read?.annotations?.readOnlyHint, true)
  assert.notEqual(write?.annotations?.readOnlyHint, true)
  assert.equal(trash?.annotations?.destructiveHint, true)
})

test('list-files scopes to a folder, excludes trashed, and slims the payload', async () => {
  mockFetch(() => ({
    body: {
      files: [
        {
          id: 'f1',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: '12',
          modifiedTime: '2026-06-30T00:00:00Z',
          owners: [{ emailAddress: 'a@x.com' }],
          webViewLink: 'u1',
        },
        { id: 'f2', name: 'sub', mimeType: 'application/vnd.google-apps.folder', webViewLink: 'u2' },
      ],
    },
  }))
  const res = json(await client().callTool('google-drive_list-files', { folderId: 'F', limit: 10 }))
  assert.equal(res.length, 2)
  assert.deepEqual(res[0], {
    id: 'f1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    isFolder: false,
    size: 12,
    modifiedTime: '2026-06-30T00:00:00Z',
    owners: ['a@x.com'],
    url: 'u1',
  })
  assert.equal(res[1].isFolder, true)
  const url = urlOf(0)
  assert.match(url, /'F' in parents and trashed = false/)
  assert.match(url, /pageSize=10/)
})

test('search-files builds a name + fullText query and escapes quotes', async () => {
  mockFetch(() => ({ body: { files: [] } }))
  await client().callTool('google-drive_search-files', { text: "o'brien" })
  const url = urlOf(0)
  assert.match(url, /name contains 'o\\'brien' or fullText contains 'o\\'brien'/)
  assert.match(url, /trashed = false/)
})

test('get-file-content exports a Google Doc to text', async () => {
  mockFetch((url) => {
    if (url.includes('/export')) return { body: 'hello world' }
    return { body: { id: 'd1', name: 'Doc', mimeType: 'application/vnd.google-apps.document' } }
  })
  const res = json(await client().callTool('google-drive_get-file-content', { fileId: 'd1' }))
  assert.equal(res.content, 'hello world')
  assert.equal(res.name, 'Doc')
  assert.match(decodeURIComponent(calls[1]!.url), /\/files\/d1\/export\?mimeType=text\/plain/)
})

test('get-file-content downloads a regular file via alt=media', async () => {
  mockFetch((url) => {
    if (url.includes('alt=media')) return { body: 'raw bytes' }
    return { body: { id: 't1', name: 'a.txt', mimeType: 'text/plain' } }
  })
  const res = json(await client().callTool('google-drive_get-file-content', { fileId: 't1' }))
  assert.equal(res.content, 'raw bytes')
  assert.match(calls[1]!.url, /\/files\/t1\?alt=media$/)
})

test('get-file-content refuses a folder', async () => {
  mockFetch(() => ({ body: { id: 'x', name: 'Stuff', mimeType: 'application/vnd.google-apps.folder' } }))
  const res = json(await client().callTool('google-drive_get-file-content', { fileId: 'x' }))
  assert.match(res.error, /folder/)
  assert.equal(calls.length, 1)
})

test('create-folder posts the folder mime type and parent', async () => {
  mockFetch(() => ({ body: { id: 'new', name: 'Reports', webViewLink: 'folder-url' } }))
  const res = json(await client().callTool('google-drive_create-folder', { name: 'Reports', parentId: 'P' }))
  assert.deepEqual(res, { id: 'new', name: 'Reports', url: 'folder-url' })
  assert.equal(calls[0]!.method, 'POST')
  assert.deepEqual(calls[0]!.body, {
    name: 'Reports',
    mimeType: 'application/vnd.google-apps.folder',
    parents: ['P'],
  })
})

test('share-file posts a permission and validates the email requirement', async () => {
  mockFetch(() => ({ body: { id: 'p1', role: 'writer', type: 'user' } }))
  const ok = json(
    await client().callTool('google-drive_share-file', {
      fileId: 'F',
      role: 'writer',
      emailAddress: 'b@x.com',
    }),
  )
  assert.deepEqual(ok, { id: 'p1', role: 'writer', type: 'user' })
  assert.deepEqual(calls[0]!.body, { role: 'writer', type: 'user', emailAddress: 'b@x.com' })

  calls = []
  const bad = json(await client().callTool('google-drive_share-file', { fileId: 'F' }))
  assert.match(bad.error, /requires an emailAddress/)
  assert.equal(calls.length, 0)
})

test('trash-file PATCHes trashed = true', async () => {
  mockFetch(() => ({ body: { id: 'F', name: 'old.txt', trashed: true } }))
  const res = json(await client().callTool('google-drive_trash-file', { fileId: 'F' }))
  assert.deepEqual(res, { id: 'F', name: 'old.txt', trashed: true })
  assert.equal(calls[0]!.method, 'PATCH')
  assert.deepEqual(calls[0]!.body, { trashed: true })
})

test('a missing token fails the call with a clear error', async () => {
  mockFetch(() => ({ body: {} }))
  const tokenless = new McpTestClient(mountConnectors([drive], { credentials: () => ({}) }))
  await assert.rejects(() => tokenless.callTool('google-drive_get-about', {}), /no Google access token/)
})

test('a non-2xx response surfaces status and detail', async () => {
  mockFetch(() => ({ status: 404, body: 'File not found' }))
  await assert.rejects(() => client().callTool('google-drive_get-file', { fileId: 'nope' }), /404/)
})
