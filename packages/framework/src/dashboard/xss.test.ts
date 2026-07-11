import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// The relay ingests events from anywhere and re-serves them to every viewer, so
// event-borne strings (session links, preview URLs, choice option ids) are
// attacker-controlled. These drive the real client JS in jsdom and assert the
// render pipeline neutralizes a `javascript:` link, a quote-breakout attribute,
// and a script URL rather than trusting the payload.

interface Harness {
  fire: (event: Record<string, unknown>) => void
  query: (sel: string) => Element | null
  window: Record<string, unknown>
}

function boot(): Harness {
  const dom = new JSDOM(dashboardHtml('Test', true, true), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as { [k: string]: unknown }
      // Neuter the polling timers so the test leaves no live handles.
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
    window,
  }
}

test('a preview event with a javascript: URL is neutralized to # (no script href)', () => {
  const h = boot()
  h.fire({ kind: 'preview', url: 'javascript:window.__pwned=1' })
  const a = h.query('#app-link') as HTMLAnchorElement | null
  assert.ok(a, '#app-link exists')
  // The href collapses to '#'; the raw URL survives only as inert text.
  assert.equal(a!.getAttribute('href'), '#')
  assert.equal(a!.textContent, 'javascript:window.__pwned=1')
  assert.equal(h.window['__pwned'], undefined)
})

test('a preview event with a real http URL keeps its href', () => {
  const h = boot()
  h.fire({ kind: 'preview', url: 'http://localhost:3000/' })
  const a = h.query('#app-link') as HTMLAnchorElement | null
  assert.equal(a!.getAttribute('href'), 'http://localhost:3000/')
})

test('a session link with a quote-breakout injects no event-handler attribute', () => {
  const h = boot()
  h.fire({
    kind: 'session',
    driver: 'x',
    workspace: 'y',
    fake: false,
    sessionLink: 'https://x" onmouseover="window.__pwned=1',
  })
  const a = h.query('#session-link a') as HTMLAnchorElement | null
  assert.ok(a, 'the session anchor rendered')
  // The `"` was escaped, so the payload stayed inside the href value instead of
  // opening a new attribute.
  assert.equal(a!.getAttribute('onmouseover'), null)
  assert.equal(a!.getAttribute('href'), 'https://x" onmouseover="window.__pwned=1')
})

test('a choice option id with an autofocus/onfocus breakout stays inert', () => {
  const h = boot()
  h.fire({
    kind: 'choice',
    id: 'plan-approval',
    title: 'Approve?',
    recommended: 'proceed',
    options: [{ id: 'x" autofocus onfocus="window.__pwned=1', label: 'Proceed' }],
  })
  const input = h.query('#choice-options input') as HTMLInputElement | null
  assert.ok(input, 'the option input rendered')
  assert.equal(input!.getAttribute('onfocus'), null)
  assert.equal(input!.getAttribute('autofocus'), null)
  assert.equal(input!.getAttribute('value'), 'x" autofocus onfocus="window.__pwned=1')
  assert.equal(h.window['__pwned'], undefined)
})
