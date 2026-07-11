import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'
import { renderResearchPrompt } from '../research-preset.js'
import { renderReadabilityPrompt } from '../readability-preset.js'
import { renderMaintainabilityPrompt } from '../maintainability-preset.js'
import { renderMaintainabilityMinimalPrompt } from '../maintainability-minimal-preset.js'

// Presets only prefill the textarea (#353): the [Research] button must load the
// full preset prompt for review and send NOTHING; Start posts the (possibly
// edited) text verbatim as kind 'prompt'. Like the autopilot smoke (#311), this
// drives the real client JS in jsdom rather than asserting the code ships.

interface StartPost {
  prompt: string
  kind: string
}

function boot() {
  const posts: StartPost[] = []
  const dom = new JSDOM(dashboardHtml('Test', true, true, true), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>
      // Neuter the page's polling timers so the test never leaves live handles.
      w['setInterval'] = () => 0
      w['setTimeout'] = () => 0
      w['EventSource'] = class {
        onmessage = null
        onerror = null
        close() {}
      }
      w['fetch'] = (url: string, opts?: { method?: string; body?: string }) => {
        if (url === 'api/start' && opts?.method === 'POST' && opts.body) posts.push(JSON.parse(opts.body) as StartPost)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ runs: [], docs: [] }) })
      }
    },
  })
  const doc = dom.window.document
  const box = doc.getElementById('start-prompt') as HTMLTextAreaElement
  return {
    posts,
    box,
    note: () => doc.getElementById('start-note')?.textContent ?? '',
    click: (id: string) => (doc.getElementById(id) as HTMLButtonElement).click(),
    type: (value: string) => {
      box.value = value
      box.dispatchEvent(new dom.window.Event('input'))
    },
  }
}

test('[Research] only prefills the textarea; Start sends the edited text verbatim (#353)', async () => {
  const h = boot()
  h.click('start-research')
  assert.equal(h.posts.length, 0) // prefill sends nothing
  assert.equal(h.box.value, renderResearchPrompt())
  assert.match(h.note(), /research preset loaded/)
  // The user customizes the prompt, then presses Start.
  h.type(h.box.value.replace('this PR', 'the auth flow'))
  h.click('start-run')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.posts.length, 1)
  assert.equal(h.posts[0]!.kind, 'prompt')
  assert.match(h.posts[0]!.prompt, /the auth flow/)
})

test('[Readability] prefills its #360 prompt the same way', async () => {
  const h = boot()
  h.click('start-readability')
  assert.equal(h.posts.length, 0) // prefill sends nothing
  assert.equal(h.box.value, renderReadabilityPrompt())
  assert.match(h.note(), /readability preset loaded/)
  h.click('start-run')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.posts.length, 1)
  assert.equal(h.posts[0]!.kind, 'prompt')
})

test('[Maintainability] prefills its #361 prompt the same way', async () => {
  const h = boot()
  h.click('start-maintainability')
  assert.equal(h.posts.length, 0) // prefill sends nothing
  assert.equal(h.box.value, renderMaintainabilityPrompt())
  assert.match(h.note(), /maintainability preset loaded/)
  h.click('start-run')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.posts.length, 1)
  assert.equal(h.posts[0]!.kind, 'prompt')
})

test('[Maintainability (minimal)] (#362) prefills the bare prompt the same way', async () => {
  const h = boot()
  h.click('start-maintainability-minimal')
  assert.equal(h.posts.length, 0) // prefill sends nothing
  assert.equal(h.box.value, renderMaintainabilityMinimalPrompt())
  assert.match(h.note(), /maintainability \(minimal\) preset loaded/)
  h.click('start-run')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.posts.length, 1)
  assert.equal(h.posts[0]!.kind, 'prompt')
})

test('clearing a prefilled preset reverts Start to a normal build run (#353)', async () => {
  const h = boot()
  h.click('start-research')
  h.type('')
  h.type('a plain blog')
  h.click('start-run')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.posts, [{ prompt: 'a plain blog', kind: 'build' }])
})
