import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// Headless smoke for the plan-approval autopilot (#311). The 10s countdown, the
// mousemove-cancel, and the Ctrl+Enter accept are all client-side JS baked into
// the page; the other dashboard tests only assert that code *ships*, not that it
// *runs*. Here we load the real page into jsdom, inject a deterministic clock, and
// drive each path to observe the pick that would be POSTed to /choice.

interface Timer {
  fn: (...a: unknown[]) => void
  period: number
  next: number
  interval: boolean
  args: unknown[]
}

// A tiny virtual clock installed in place of the window's timers, so the countdown
// advances deterministically with no real waiting. The page references bare
// `setInterval`/`setTimeout`, which resolve to these window methods.
function installClock(window: { [k: string]: unknown }) {
  let now = 0
  let seq = 1
  const timers = new Map<number, Timer>()
  window['setTimeout'] = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = seq++
    timers.set(id, { fn, period: ms, next: now + ms, interval: false, args })
    return id
  }
  window['setInterval'] = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = seq++
    timers.set(id, { fn, period: ms, next: now + ms, interval: true, args })
    return id
  }
  window['clearTimeout'] = (id: number) => timers.delete(id)
  window['clearInterval'] = (id: number) => timers.delete(id)
  return {
    // Advance virtual time by `ms`, firing every due timer in chronological order.
    tick(ms: number) {
      const target = now + ms
      for (;;) {
        let due: { id: number; t: Timer } | null = null
        for (const [id, t] of timers) {
          if (t.next <= target && (due === null || t.next < due.t.next || (t.next === due.t.next && id < due.id)))
            due = { id, t }
        }
        if (!due) break
        now = due.t.next
        if (due.t.interval) due.t.next = now + due.t.period
        else timers.delete(due.id)
        due.t.fn(...due.t.args)
      }
      now = target
    },
  }
}

interface Pick {
  id: string
  pick: string
  by: string
}

interface Harness {
  fire: (event: Record<string, unknown>) => void
  tick: (ms: number) => void
  picks: Pick[]
  el: (id: string) => { hidden: boolean; textContent: string }
  dispatch: (type: 'mousemove' | 'keydown', init?: Record<string, unknown>) => void
  window: Record<string, unknown>
}

// Boot the real dashboard page in jsdom with stubbed EventSource/fetch and the
// virtual clock, then hand back drivers for the choice stream and the DOM.
function boot(): Harness {
  const picks: Pick[] = []
  let clock: ReturnType<typeof installClock>
  const dom = new JSDOM(dashboardHtml('Test', true, true), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as { [k: string]: unknown }
      clock = installClock(w)
      // Capture the EventSource so the test can push 'choice' frames through the
      // page's own onmessage handler.
      w['EventSource'] = class {
        onmessage: ((ev: { data: string }) => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          w['__es'] = this
        }
        close() {}
      }
      // Record only the choice pick; the periodic runs/docs polls also fetch and
      // are answered with empty payloads.
      w['fetch'] = (url: string, opts?: { method?: string; body?: string }) => {
        if (url === 'choice' && opts?.method === 'POST' && opts.body) picks.push(JSON.parse(opts.body) as Pick)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ runs: [], docs: [] }) })
      }
    },
  })
  const window = dom.window as unknown as { [k: string]: unknown }
  const doc = dom.window.document
  return {
    picks,
    fire(event) {
      const es = window['__es'] as { onmessage: ((ev: { data: string }) => void) | null }
      es.onmessage?.({ data: JSON.stringify(event) })
    },
    tick(ms) {
      clock.tick(ms)
    },
    el(id) {
      const node = doc.getElementById(id)
      assert.ok(node, `#${id} exists`)
      return node as unknown as { hidden: boolean; textContent: string }
    },
    dispatch(type, init) {
      const Ctor = type === 'mousemove' ? dom.window.MouseEvent : dom.window.KeyboardEvent
      doc.dispatchEvent(new Ctor(type, init as never))
    },
    window,
  }
}

const CHOICE = {
  kind: 'choice',
  id: 'plan-approval',
  title: 'Approve the plan?',
  recommended: 'proceed',
  options: [
    { id: 'proceed', label: 'Proceed' },
    { id: 'revise', label: 'Revise' },
  ],
  autoAcceptMs: 10000,
}

test('autopilot countdown auto-accepts the recommended pick after 10s (#311)', () => {
  const h = boot()
  h.fire(CHOICE)
  // The panel opens and the countdown is armed at 10s.
  assert.equal(h.el('choice-panel').hidden, false)
  assert.match(h.el('choice-count').textContent, /accepting in 10s/)
  // Nine seconds in: still counting, not yet accepted.
  h.tick(9000)
  assert.match(h.el('choice-count').textContent, /accepting in 1s/)
  assert.equal(h.picks.length, 0)
  // The tenth tick fires the autopilot accept of the recommended option.
  h.tick(1000)
  assert.deepEqual(h.picks, [{ id: 'plan-approval', pick: 'proceed', by: 'autopilot' }])
  assert.equal(h.el('choice-panel').hidden, true)
})

test('a mouse move cancels the autopilot countdown so it never auto-accepts (#311)', () => {
  const h = boot()
  h.fire(CHOICE)
  h.tick(3000) // part-way through the countdown
  assert.equal(h.picks.length, 0)
  h.dispatch('mousemove')
  assert.match(h.el('choice-count').textContent, /canceled/)
  // Long past the original deadline: no auto-accept, panel still awaiting a pick.
  h.tick(30000)
  assert.equal(h.picks.length, 0)
  assert.equal(h.el('choice-panel').hidden, false)
})

test('Ctrl+Enter accepts the choice as the user and stops the countdown (#311)', () => {
  const h = boot()
  h.fire(CHOICE)
  h.dispatch('keydown', { key: 'Enter', ctrlKey: true })
  assert.deepEqual(h.picks, [{ id: 'plan-approval', pick: 'proceed', by: 'user' }])
  assert.equal(h.el('choice-panel').hidden, true)
  // The countdown was cleared, so no stray autopilot accept follows.
  h.tick(30000)
  assert.equal(h.picks.length, 1)
})
