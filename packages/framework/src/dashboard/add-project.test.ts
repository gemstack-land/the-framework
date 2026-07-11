import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// The Add project(s) control (#396) POSTs a path to /api/projects and reloads the
// list on success. Drives the real client JS in jsdom, recording each fetch.

interface Call { url: string; method: string; body: string | undefined }

function boot(addable: boolean): {
  query: (sel: string) => Element | null
  calls: Call[]
  window: Window & typeof globalThis
} {
  const calls: Call[] = []
  const dom = new JSDOM(dashboardHtml('Test', true, true, true, addable), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as { [k: string]: unknown }
      w['setInterval'] = () => 0
      w['setTimeout'] = () => 0
      w['EventSource'] = class {
        onmessage: ((ev: { data: string }) => void) | null = null
        onerror: (() => void) | null = null
        close() {}
      }
      w['fetch'] = (url: string, opts?: { method?: string; body?: string }) => {
        const method = (opts && opts.method) || 'GET'
        calls.push({ url, method, body: opts && opts.body })
        let body: unknown = {}
        if (url === 'api/projects' && method === 'POST') body = { ok: true, added: 1, alreadyActivated: 0 }
        else if (url === 'api/projects') body = { projects: [] }
        else if (url.indexOf('api/logs') === 0) body = { logs: [] }
        else if (url.indexOf('api/docs') === 0) body = { docs: [] }
        else if (url.indexOf('api/runs') === 0) body = { runs: [] }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
      }
    },
  })
  return {
    query: sel => dom.window.document.querySelector(sel),
    calls,
    window: dom.window as unknown as Window & typeof globalThis,
  }
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }

test('the Add control is hidden unless the server enables adding', async () => {
  assert.equal(boot(false).query('#add-project')!.hasAttribute('hidden'), true)
  assert.equal(boot(true).query('#add-project')!.hasAttribute('hidden'), false)
})

test('adding a project POSTs the path, shows a result, and reloads the list', async () => {
  const h = boot(true)
  await tick()
  // The form starts hidden; the Add button reveals it.
  assert.equal(h.query('#add-project-form')!.hasAttribute('hidden'), true)
  ;(h.query('#add-project') as unknown as { click: () => void }).click()
  assert.equal(h.query('#add-project-form')!.hasAttribute('hidden'), false)

  const input = h.query('#add-project-path') as HTMLInputElement
  input.value = '/repos/app-a'
  ;(h.query('#add-project-dir') as HTMLInputElement).checked = true
  h.query('#add-project-form')!.dispatchEvent(new h.window.Event('submit', { cancelable: true, bubbles: true }))
  await tick()

  const post = h.calls.find(c => c.url === 'api/projects' && c.method === 'POST')
  assert.ok(post, 'a POST to /api/projects was made')
  assert.deepEqual(JSON.parse(post!.body ?? '{}'), { path: '/repos/app-a', directory: true })
  assert.match(h.query('#add-project-note')!.textContent ?? '', /added 1 project/)
  // The list is reloaded (a GET after the POST) and the path input is cleared.
  assert.ok(h.calls.some(c => c.url === 'api/projects' && c.method === 'GET'))
  assert.equal(input.value, '')
})

test('an empty path is rejected client-side without a POST', async () => {
  const h = boot(true)
  await tick()
  ;(h.query('#add-project') as unknown as { click: () => void }).click()
  const before = h.calls.filter(c => c.method === 'POST').length
  h.query('#add-project-form')!.dispatchEvent(new h.window.Event('submit', { cancelable: true, bubbles: true }))
  await tick()
  assert.equal(h.calls.filter(c => c.method === 'POST').length, before, 'no POST for an empty path')
  assert.match(h.query('#add-project-note')!.textContent ?? '', /enter a path/)
})

test('a relative path is rejected client-side with an absolute-path hint, no POST', async () => {
  const h = boot(true)
  await tick()
  ;(h.query('#add-project') as unknown as { click: () => void }).click()
  ;(h.query('#add-project-path') as HTMLInputElement).value = 'first-project'
  const before = h.calls.filter(c => c.method === 'POST').length
  h.query('#add-project-form')!.dispatchEvent(new h.window.Event('submit', { cancelable: true, bubbles: true }))
  await tick()
  assert.equal(h.calls.filter(c => c.method === 'POST').length, before, 'no POST for a relative path')
  assert.match(h.query('#add-project-note')!.textContent ?? '', /absolute path/)
})
