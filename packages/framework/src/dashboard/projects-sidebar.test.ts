import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// The Projects sidebar (#394) renders /api/projects into Overview / Projects /
// Queue, and selecting a project re-points the project log to ?project=<id>. This
// drives the real client JS in jsdom, answering its fetches with canned payloads.

interface Harness {
  query: (sel: string) => Element | null
  queryAll: (sel: string) => Element[]
  calls: string[]
}

function boot(opts: {
  projects: unknown[]
  docsByProject?: Record<string, unknown[]>
}): Harness {
  const calls: string[] = []
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
        calls.push(url)
        let body: unknown = {}
        if (url === 'api/projects') body = { projects: opts.projects }
        else if (url.indexOf('api/logs') === 0) body = { logs: [] }
        else if (url.indexOf('api/docs') === 0) {
          const id = decodeURIComponent((url.split('project=')[1] || ''))
          body = { docs: (opts.docsByProject || {})[id] || [] }
        } else if (url.indexOf('api/runs') === 0) body = { runs: [] }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
      }
    },
  })
  const doc = dom.window.document
  return {
    query: sel => doc.querySelector(sel),
    queryAll: sel => [...doc.querySelectorAll(sel)],
    calls,
  }
}

// The page fetches on load then chains (projects -> queue); give microtasks room.
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }

const PROJECTS = [
  { id: 'a-1', path: '/repos/app-a', name: 'app-a', activated: true, lastActivityAt: '2026-07-11T10:00:00.000Z' },
  { id: 'b-2', path: '/repos/app-b', name: 'app-b', activated: false },
]

test('the Projects list renders each project, newest activity first, with an activation dot', async () => {
  const h = boot({ projects: PROJECTS })
  await tick()
  const items = h.queryAll('#projects > li')
  assert.equal(items.length, 2)
  assert.match(items[0]!.textContent ?? '', /app-a/) // most recent first
  assert.match(items[1]!.textContent ?? '', /app-b/)
  assert.ok(h.query('#projects .adot.on'), 'an activated project shows the filled dot')
  assert.ok(h.query('#projects .adot.off'), 'a project whose marker is gone shows the hollow dot')
})

test('the Overview shows a project count and active tally', async () => {
  const h = boot({ projects: PROJECTS })
  await tick()
  assert.match(h.query('#overview .ov-count')!.textContent ?? '', /2 projects.*1 active/)
})

test('selecting a project marks it active and re-points the project log to ?project=<id>', async () => {
  const h = boot({ projects: PROJECTS })
  await tick()
  const first = h.query('#projects > li') as HTMLElement
  ;(first as unknown as { click: () => void }).click()
  await tick()
  assert.ok(first.classList.contains('active'), 'the clicked project is highlighted')
  assert.ok(h.calls.some(u => u === 'api/logs?project=a-1'), 'the log is refetched scoped to the project')
})

test('the Queue aggregates unchecked TODO items across projects, tagged by project', async () => {
  const h = boot({
    projects: PROJECTS,
    docsByProject: {
      'a-1': [{ name: 'TODO.md', content: '# Todo\n- [ ] ship the sidebar\n- [x] done already\n- [ ] write tests\n' }],
      'b-2': [{ name: 'PLAN.md', content: 'no checklist here' }],
    },
  })
  await tick()
  const items = h.queryAll('#queue > li')
  assert.equal(items.length, 2) // only the two unchecked items from app-a
  assert.match(items[0]!.textContent ?? '', /ship the sidebar/)
  assert.match(items[0]!.textContent ?? '', /app-a/)
  assert.doesNotMatch(h.query('#queue')!.textContent ?? '', /done already/)
})

test('a project name is rendered as inert text, never markup (XSS)', async () => {
  const h = boot({ projects: [{ id: 'x-1', path: '/x', name: '<img src=x onerror=alert(1)>', activated: true }] })
  await tick()
  assert.equal(h.queryAll('#projects img').length, 0, 'no element is injected from the name')
  assert.match(h.query('#projects')!.innerHTML, /&lt;img/, 'the name is HTML-escaped')
})
