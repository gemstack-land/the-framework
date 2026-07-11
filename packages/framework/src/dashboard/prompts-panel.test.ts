import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// The Prompts panel (#343) shows every prompt sent to Claude Code: the system
// prompt (a `system-prompt` event) plus each turn's user prompt (harvested from
// the `driver` `start` events already in the stream). These drive the real
// client JS in jsdom.

interface Harness {
  fire: (event: Record<string, unknown>) => void
  query: (sel: string) => Element | null
  queryAll: (sel: string) => Element[]
  window: Record<string, unknown>
}

function boot(): Harness {
  const dom = new JSDOM(dashboardHtml('Test', true, true), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as { [k: string]: unknown }
      w['setInterval'] = () => 0
      w['setTimeout'] = () => 0
      w['EventSource'] = class {
        onmessage: ((ev: { data: string }) => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          w['__es'] = this
        }
        close() {}
      }
      w['fetch'] = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ runs: [], docs: [] }) })
    },
  })
  const window = dom.window as unknown as { [k: string]: unknown }
  const doc = dom.window.document
  return {
    fire(event) {
      const es = window['__es'] as { onmessage: ((ev: { data: string }) => void) | null }
      es.onmessage?.({ data: JSON.stringify(event) })
    },
    query: sel => doc.querySelector(sel),
    queryAll: sel => [...doc.querySelectorAll(sel)],
    window,
  }
}

test('the Prompts panel stays hidden until a prompt arrives', () => {
  const h = boot()
  assert.equal((h.query('#prompts-panel') as HTMLElement).hidden, true)
})

test('a system-prompt event and driver start events render one entry each, in order', () => {
  const h = boot()
  h.fire({ kind: 'system-prompt', text: '# System prompt\nBe transparent.' })
  h.fire({ kind: 'driver', event: { type: 'start', prompt: 'refactor the auth flow' } })
  h.fire({ kind: 'driver', event: { type: 'start', prompt: 'continue with the pick' } })

  assert.equal((h.query('#prompts-panel') as HTMLElement).hidden, false)
  const entries = h.queryAll('#prompts details')
  assert.equal(entries.length, 3)
  const summaries = h.queryAll('#prompts summary').map(s => s.textContent)
  assert.deepEqual(summaries, ['System prompt', 'Turn 1', 'Turn 2'])
  const bodies = h.queryAll('#prompts pre').map(p => p.textContent)
  assert.deepEqual(bodies, ['# System prompt\nBe transparent.', 'refactor the auth flow', 'continue with the pick'])
})

test('prompt text is rendered as inert text, never markup (agent-controlled)', () => {
  const h = boot()
  h.fire({ kind: 'system-prompt', text: '<img src=x onerror="window.__pwned=1">' })
  // The payload survives verbatim as text, and no <img> was ever created.
  assert.equal(h.query('#prompts pre')!.textContent, '<img src=x onerror="window.__pwned=1">')
  assert.equal(h.queryAll('#prompts img').length, 0)
  assert.equal(h.window['__pwned'], undefined)
})
