import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAwaitGate } from './await-gate.js'
import { BROWSER_HANDLED, BROWSER_NOT_HANDLED, parseAwaitGate, parseBrowserGate } from './turn-gate.js'

const block = (body: string) => `Stuck on the login page.\n\n\`\`\`await-browser\n${body}\n\`\`\``

test('parseBrowserGate reads the title and the page the agent is stuck on (#796)', () => {
  const gate = parseBrowserGate(block('{ "title": "Log in to the dashboard", "url": "https://app.example.com/login" }'))
  assert.deepEqual(gate, { title: 'Log in to the dashboard', url: 'https://app.example.com/login' })
})

test('parseBrowserGate falls back rather than showing a blank prompt', () => {
  assert.deepEqual(parseBrowserGate(block('{}')), { title: 'Take over in the browser' })
})

test('parseBrowserGate drops a non-string url instead of rendering "undefined"', () => {
  assert.deepEqual(parseBrowserGate(block('{ "title": "Solve the captcha", "url": 42 }')), { title: 'Solve the captcha' })
})

test('parseBrowserGate ignores a malformed block rather than crashing the run', () => {
  assert.equal(parseBrowserGate(block('{ not json')), undefined)
  assert.equal(parseBrowserGate(block('"a string"')), undefined)
})

test('a turn with no browser block is not a gate', () => {
  assert.equal(parseBrowserGate('All done, the tests pass.'), undefined)
})

test('parseAwaitGate recognises the browser gate alongside the other kinds', () => {
  const gate = parseAwaitGate(block('{ "title": "Sign in", "url": "https://x.test/" }'))
  assert.equal(gate?.kind, 'browser')
  assert.equal(gate?.kind === 'browser' ? gate.title : '', 'Sign in')
})

test('the latest block wins when a turn carries a choice and a browser gate', () => {
  const text = '```await-choices\n{ "title": "Which?", "options": [{ "label": "A" }] }\n```\n' + block('{ "title": "Log in" }')
  assert.equal(parseAwaitGate(text)?.kind, 'browser')
})

test('resolveAwaitGate offers handled / could-not-handle and reports what the user picked', async () => {
  const events: unknown[] = []
  const answer = await resolveAwaitGate({ kind: 'browser', title: 'Log in', url: 'https://x.test/' }, 0, {
    emit: e => events.push(e),
    requestChoice: async req => {
      assert.equal(req.id, 'await-browser')
      assert.ok(req.title.includes('https://x.test/'), 'the user is told which page to look at')
      assert.deepEqual(req.options.map(o => o.label), [BROWSER_HANDLED, BROWSER_NOT_HANDLED])
      return { picked: 'handled' }
    },
  })
  assert.equal(answer, BROWSER_HANDLED)
})

test('an unattended run answers "could not handle it" — nobody was at the browser (#796)', async () => {
  // No requestChoice: the headless path falls back to the recommended option. Recommending
  // "handled" would send the agent back to a page that is still blocked.
  const answer = await resolveAwaitGate({ kind: 'browser', title: 'Solve the captcha' }, 0, { emit: () => {} })
  assert.equal(answer, BROWSER_NOT_HANDLED)
})

test('a re-ask in a later round gets its own gate id', async () => {
  let seen = ''
  await resolveAwaitGate({ kind: 'browser', title: 'Log in' }, 2, {
    emit: () => {},
    requestChoice: async req => {
      seen = req.id
      return { picked: 'handled' }
    },
  })
  assert.equal(seen, 'await-browser-2')
})
