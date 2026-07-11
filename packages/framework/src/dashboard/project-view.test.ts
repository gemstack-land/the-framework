import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// The per-project second sidebar + main view (#395): selecting a project shows its
// .the-framework/LOGS.md loops in the second sidebar (#projectlog), and the main
// view (#project-view) shows the selected/latest entry claude.ai/code-style. Drives
// the real client JS in jsdom against canned /api endpoints.

interface Harness {
  query: (sel: string) => Element | null
  queryAll: (sel: string) => Element[]
}

function boot(logs: unknown[]): Harness {
  const project = { id: 'p1', path: '/demo', name: 'demo', activated: true, lastActivityAt: '2026-07-11T10:00:00.000Z' }
  const dom = new JSDOM(dashboardHtml('Test', true, true, true), {
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
      w['fetch'] = (url: string) => {
        let body: unknown = {}
        if (url === 'api/projects') body = { projects: [project] }
        else if (url.indexOf('api/logs') === 0) body = { logs }
        else if (url.indexOf('api/docs') === 0) body = { docs: [] }
        else if (url.indexOf('api/runs') === 0) body = { runs: [] }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
      }
    },
  })
  const doc = dom.window.document
  return { query: sel => doc.querySelector(sel), queryAll: sel => [...doc.querySelectorAll(sel)] }
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }

const LOGS = [
  { at: '2026-07-11T10:00:00.000Z', kind: 'loop', title: 'polish the dashboard', status: 'running', prompts: ['fix header', 'tidy states'] },
  { at: '2026-07-10T09:00:00.000Z', kind: 'prompt', title: 'add login', status: 'done', sessionId: 's1', sessionLink: 'https://claude.ai/code/s1' },
]

test('the selected project loops render in the second sidebar', async () => {
  const h = boot(LOGS)
  await tick()
  assert.equal(h.queryAll('#sidebar #projectlog > li').length, 2)
  assert.match(h.query('#loops-heading')!.textContent ?? '', /Loops.*demo/)
})

test('the main view shows the latest loop by default, with its prompts', async () => {
  const h = boot(LOGS)
  await tick()
  assert.equal(h.query('#project-view')!.hasAttribute('hidden'), false)
  assert.equal(h.query('#pv-title')!.textContent, 'polish the dashboard')
  assert.equal(h.query('#pv-kind')!.textContent, 'loop')
  assert.equal(h.queryAll('#pv-prompts li').length, 2)
})

test('clicking another loop shows it in the main view', async () => {
  const h = boot(LOGS)
  await tick()
  const second = h.queryAll('#sidebar #projectlog > li')[1] as HTMLElement
  ;(second as unknown as { click: () => void }).click()
  await tick()
  assert.equal(h.query('#pv-title')!.textContent, 'add login')
  assert.equal(h.queryAll('#pv-prompts li').length, 0) // a standalone prompt has none
  const link = h.query('#pv-meta a') as HTMLAnchorElement | null
  assert.equal(link!.getAttribute('href'), 'https://claude.ai/code/s1')
  assert.ok(second.classList.contains('active'))
})

test('with no logged runs the main view stays hidden', async () => {
  const h = boot([])
  await tick()
  assert.equal(h.query('#project-view')!.hasAttribute('hidden'), true)
})

test('a log title is rendered as inert text in the main view (XSS)', async () => {
  const h = boot([{ at: '2026-07-11T10:00:00.000Z', kind: 'build', title: '<img src=x onerror=alert(1)>', status: 'done' }])
  await tick()
  assert.equal(h.queryAll('#project-view img').length, 0)
  assert.match(h.query('#pv-body')!.innerHTML, /&lt;img/)
})
