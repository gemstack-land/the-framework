import 'reflect-metadata'
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { McpTestClient } from '@gemstack/mcp/testing'
import type { McpToolResult } from '@gemstack/mcp'
import { mountConnectors } from '@gemstack/connectors'
import github from './index.js'

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
  return new McpTestClient(mountConnectors([github], { credentials: () => ({ token }) }))
}

function json(result: McpToolResult): any {
  const first = result.content[0]
  return first && first.type === 'text' ? JSON.parse(first.text) : undefined
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
  assert.ok(names.includes('github_list-issues'))
  assert.ok(names.includes('github_create-issue'))
  assert.equal(tools.length, 9)
  const read = tools.find((t) => t.name === 'github_get-issue')
  const write = tools.find((t) => t.name === 'github_create-issue')
  assert.equal(read?.annotations?.readOnlyHint, true)
  assert.notEqual(write?.annotations?.readOnlyHint, true)
})

test('list-issues filters out pull requests and slims the payload', async () => {
  mockFetch(() => ({
    body: [
      { number: 1, title: 'a bug', state: 'open', user: { login: 'alice' }, labels: [{ name: 'bug' }], comments: 2, html_url: 'u1' },
      { number: 2, title: 'a pr', state: 'open', user: { login: 'bob' }, pull_request: { url: 'x' }, html_url: 'u2' },
    ],
  }))
  const res = json(await client().callTool('github_list-issues', { owner: 'o', repo: 'r' }))
  assert.equal(res.length, 1)
  assert.deepEqual(res[0], {
    number: 1,
    title: 'a bug',
    state: 'open',
    author: 'alice',
    labels: ['bug'],
    comments: 2,
    isPullRequest: false,
    url: 'u1',
  })
  assert.match(calls[0]!.url, /\/repos\/o\/r\/issues\?state=open&per_page=30/)
})

test('get-file base64-decodes content', async () => {
  mockFetch(() => ({
    body: { path: 'README.md', size: 5, sha: 'abc', encoding: 'base64', content: Buffer.from('hello').toString('base64') },
  }))
  const res = json(await client().callTool('github_get-file', { owner: 'o', repo: 'r', path: 'README.md' }))
  assert.equal(res.content, 'hello')
  assert.equal(res.path, 'README.md')
})

test('comment-on-issue POSTs the body and returns the comment ref', async () => {
  mockFetch(() => ({ body: { id: 99, html_url: 'comment-url' } }))
  const res = json(await client().callTool('github_comment-on-issue', { owner: 'o', repo: 'r', number: 7, body: 'hi' }))
  assert.deepEqual(res, { id: 99, url: 'comment-url' })
  assert.equal(calls[0]!.method, 'POST')
  assert.match(calls[0]!.url, /\/repos\/o\/r\/issues\/7\/comments$/)
  assert.deepEqual(calls[0]!.body, { body: 'hi' })
})

test('create-issue sends title + body and omits unset labels', async () => {
  mockFetch(() => ({ body: { number: 42, html_url: 'issue-url' } }))
  const res = json(await client().callTool('github_create-issue', { owner: 'o', repo: 'r', title: 'T', body: 'B' }))
  assert.deepEqual(res, { number: 42, url: 'issue-url' })
  assert.deepEqual(calls[0]!.body, { title: 'T', body: 'B' })
})

test('a missing token fails the call with a clear error', async () => {
  mockFetch(() => ({ body: {} }))
  const tokenless = new McpTestClient(mountConnectors([github], { credentials: () => ({}) }))
  await assert.rejects(() => tokenless.callTool('github_get-repo', { owner: 'o', repo: 'r' }), /no GitHub token/)
})

test('a non-2xx response surfaces status and detail', async () => {
  mockFetch(() => ({ status: 404, body: 'Not Found' }))
  await assert.rejects(
    () => client().callTool('github_get-issue', { owner: 'o', repo: 'r', number: 1 }),
    /404/,
  )
})
