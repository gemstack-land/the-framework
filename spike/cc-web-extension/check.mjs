// Runs the content script against a synthetic page carrying the exact await-choices block our
// agents emit, so the parsing half is proven without needing anyone's browser or a live session.
//
// What this does NOT prove is the only thing left: whether claude.ai's real DOM puts the block
// somewhere these strategies reach. That is what loading the extension answers.
//
//   node --experimental-vm-modules check.mjs      (from this directory, after a repo pnpm install)

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
// jsdom belongs to the dashboard package; this directory is outside the workspace globs on
// purpose, so resolve through the package that actually depends on it.
const require_ = createRequire(import.meta.url)
const { JSDOM } = require_(require_.resolve('jsdom', { paths: [join(here, '../../packages/framework-dashboard')] }))

const block = JSON.stringify(
  {
    title: 'What would you like me to do?',
    options: [{ label: 'Work on the next TODO' }, { label: 'Tell you about current state' }, { label: "I'll tell you what to do" }],
    recommended: 'Work on the next TODO',
  },
  null,
  2,
)

// Indented differently on purpose: the parser must not depend on an indentation nobody
// promised, which is what round 2 of the spike failed on.
const wideBlock = JSON.stringify(JSON.parse(block), null, 4)
// A highlighter splits a block into per-token elements; textContent still rejoins it.
const highlighted = wideBlock
  .split('\n')
  .map(line => `<span class="line">${line.replace(/</g, '&lt;')}</span>`)
  .join('\n')

// The await-choices spec exactly as our system prompt states it, placeholders and all.
// Escaped, because these fixtures go in through innerHTML and `<the question>` would otherwise
// be parsed as an HTML tag and vanish from textContent. The real page escapes it too.
const esc = t => t.replace(/</g, '&lt;').replace(/>/g, '&gt;')
const SPEC = esc(JSON.stringify({
  title: '<the question>',
  options: [{ label: '<option>', detail: '<optional one-liner>' }],
  recommended: '<the label to default to>',
}, null, 2))

const cases = [
  ['fenced code block', `<pre><code>${block}</code></pre><div contenteditable="true"></div>`, true],
  ['pre without code', `<pre>${block}</pre><textarea></textarea>`, true],
  // The shape claude.ai actually uses: <code> with no <pre> wrapper at all (round 1).
  ['code without pre', `<code>${block}</code><div contenteditable="true"></div>`, true],
  ['four space indent', `<code>${wideBlock}</code><div contenteditable="true"></div>`, true],
  ['split across spans by a highlighter', `<code>${highlighted}</code><div contenteditable="true"></div>`, true],
  ['prose around the block', `<div>Your prompt "hi" is ambiguous! Let me clarify:</div><code>${block}</code><div>anything else?</div><div contenteditable="true"></div>`, true],
  // Round 2's finding: the message body lives behind a shadow root, so nothing in the light
  // DOM sees it. Built after parse, below.
  ['inside a shadow root', { shadow: block }, true],
  ['no question present', `<pre><code>console.log(1)</code></pre><div contenteditable="true"></div>`, false],
  // Round 3's finding: the page renders our system prompt, so the await-protocol spec appears
  // as a JSON block with `options` before the agent has asked anything. Taking the first match
  // reported "<the question>" as the question. The spec must lose to the real one.
  ['protocol spec then the real question', `<pre><code>${SPEC}</code></pre><code>${block}</code><div contenteditable="true"></div>`, true],
  // And on a session that has not asked yet, the spec alone must not count as a question.
  ['protocol spec only', `<pre><code>${SPEC}</code></pre><div contenteditable="true"></div>`, false],
]

const script = readFileSync(join(here, 'content.js'), 'utf8')
let failed = 0

for (const [name, body, expectFound] of cases) {
  const shadow = typeof body === 'object' ? body.shadow : undefined
  const light = shadow ? '<div id="host"></div><div contenteditable="true"></div>' : body
  const dom = new JSDOM(`<!doctype html><html><body><main>${light}</main></body></html>`, {
    url: 'https://claude.ai/code/session_01TEST',
    runScripts: 'outside-only',
  })
  if (shadow) {
    const host = dom.window.document.getElementById('host')
    host.attachShadow({ mode: 'open' }).innerHTML = `<code>${shadow}</code>`
  }
  dom.window.eval(script)
  // The panel is appended to documentElement, so it is a direct child rather than in the body.
  const text = [...dom.window.document.documentElement.children]
    .filter(el => el.tagName === 'DIV')
    .map(el => el.textContent)
    .join(' ')
  const found = /question found\s*yes/.test(text)
  const composerOk = /composer\s*(contenteditable|textarea)/.test(text)
  const titleOk = !expectFound || /What would you like me to do\?/.test(text)
  const ok = found === expectFound && composerOk && titleOk
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (found=${found}, expected=${expectFound}, composer=${composerOk}, title=${titleOk})`)
  dom.window.close()
}

// ---------------------------------------------------------------------------
// The write half (#1237): the dashboard's pick being typed into the composer and submitted.
// jsdom has no execCommand, so these exercise the fallback fill; what they prove is the flow
// around it: the composer is filled, a labelled send button is preferred, Enter is the
// fallback, and a page with no composer is refused rather than guessed at.

async function deliver(body, prepare) {
  const dom = new JSDOM(`<!doctype html><html><body><main>${body}</main></body></html>`, {
    url: 'https://claude.ai/code/session_01TEST',
    runScripts: 'outside-only',
  })
  dom.window.eval(script)
  const observed = prepare ? prepare(dom.window) : undefined
  const result = await dom.window.__tfBridgeDeliverAnswer('Work on the next TODO')
  return { dom, result, observed }
}

{
  const { dom, result, observed } = await deliver(
    `<div contenteditable="true"></div><button aria-label="Send message" id="send"></button>`,
    w => {
      const seen = { clicked: false }
      w.document.getElementById('send').addEventListener('click', () => {
        seen.clicked = true
      })
      return seen
    },
  )
  const text = dom.window.document.querySelector('[contenteditable="true"]').textContent
  const ok = result.ok && observed.clicked && /clicked send button/.test(result.note) && text === 'Work on the next TODO'
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  answer fills the composer and clicks send  (clicked=${observed.clicked}, text="${text}")`)
  dom.window.close()
}

{
  const { dom, result, observed } = await deliver(`<div contenteditable="true"></div>`, w => {
    const seen = { enter: false }
    w.document.querySelector('[contenteditable="true"]').addEventListener('keydown', e => {
      if (e.key === 'Enter') seen.enter = true
    })
    return seen
  })
  const ok = result.ok && observed.enter && /sent Enter/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  answer falls back to Enter without a send button  (enter=${observed.enter})`)
  dom.window.close()
}

{
  const { dom, result } = await deliver(`<p>nothing to type into</p>`, w => {
    // Shorten the composer wait: this page never gains one, and the real 20s is for claude.ai
    // still rendering after a tab revive.
    w.__tfComposerWaitMs = 100
    return undefined
  })
  const ok = !result.ok && /no composer/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  answer refuses honestly when there is no composer  (ok=${result.ok})`)
  dom.window.close()
}

// ---------------------------------------------------------------------------
// Creating a session (#1328), against a fake new-session page.
//
// Every selector in `createSession` is a guess about someone else's markup, so what these prove
// is the FLOW, not that claude.ai looks like this: that a repo and a branch are chosen from
// menus before the prompt is sent, that the session id is read from the URL rather than from
// anything on the page, and that each way it can go wrong is reported with the control it could
// not find. Whether the real page matches is what `probeNewSession` is for.

/** A stand-in new-session page: two menus, a composer, a send button. */
function newSessionPage({ repos = ['someone/other-repo', 'gemstack-land/the-framework'], branches = ['main', 'dev'], composer = true, repoLabel = 'Select repository', branchLabel = 'Select branch' } = {}) {
  const options = (items, menu) =>
    items.map(text => `<div role="option" aria-hidden="true" data-menu="${menu}">${text}</div>`).join('')
  return [
    `<button id="repo-trigger" aria-haspopup="listbox">${repoLabel}</button>`,
    `<div>${options(repos, 'repo')}</div>`,
    `<button id="branch-trigger" aria-haspopup="listbox">${branchLabel}</button>`,
    `<div>${options(branches, 'branch')}</div>`,
    composer ? '<div contenteditable="true"></div>' : '<p>no composer here</p>',
    '<button aria-label="Send message" id="send"></button>',
  ].join('')
}

/**
 * Run `createSession` against a fake page.
 *
 * The menus toggle on their trigger exactly as a real one would, and the send button is what
 * turns the page into a session: jsdom cannot navigate, so the harness reconfigures the URL on
 * click, which is the same observable the content script waits for.
 */
async function createOn(page, { becomesSession = 'session_01FAKE', ...opts } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><main>${page}</main></body></html>`, {
    // No session id yet: this is the page a session is started FROM.
    url: 'https://claude.ai/code',
    runScripts: 'outside-only',
  })
  dom.window.eval(script)
  const w = dom.window
  w.__tfComposerWaitMs = 200
  w.__tfMenuSettleMs = 10
  w.__tfSessionWaitMs = 2000

  const toggle = menu => {
    for (const option of w.document.querySelectorAll(`[data-menu="${menu}"]`)) {
      option.setAttribute('aria-hidden', option.getAttribute('aria-hidden') === 'true' ? 'false' : 'true')
    }
  }
  w.document.getElementById('repo-trigger')?.addEventListener('click', () => toggle('repo'))
  w.document.getElementById('branch-trigger')?.addEventListener('click', () => toggle('branch'))
  if (becomesSession) {
    w.document.getElementById('send')?.addEventListener('click', () => {
      dom.reconfigure({ url: `https://claude.ai/code/${becomesSession}` })
    })
  }

  const result = await w.__tfBridgeCreateSession({
    repo: 'gemstack-land/the-framework',
    branch: 'main',
    prompt: 'Spike and plan the queue ticket',
    ...opts,
  })
  return { dom, w, result }
}

{
  const { dom, w, result } = await createOn(newSessionPage())
  const typed = w.document.querySelector('[contenteditable="true"]').textContent
  const ok =
    result.ok &&
    result.sessionId === 'session_01FAKE' &&
    typed === 'Spike and plan the queue ticket' &&
    /repository: clicked "gemstack-land\/the-framework"/.test(result.note) &&
    /branch: clicked "main"/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  create picks repo and branch, types the prompt, reports the session  (id=${result.sessionId}, note=${result.note})`)
  dom.window.close()
}

{
  // The repo the daemon asked for is not on offer: refuse, and say which control failed. Sending
  // anyway would start a session against whatever repo happened to be selected.
  const { dom, result } = await createOn(newSessionPage({ repos: ['someone/other-repo'] }))
  const ok = !result.ok && /repository/.test(result.note) && !/branch:/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  create refuses when the repo is not offered  (note=${result.note})`)
  dom.window.close()
}

{
  const { dom, result } = await createOn(newSessionPage({ branches: ['dev'] }))
  const ok = !result.ok && /branch/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  create refuses when the branch is not offered  (note=${result.note})`)
  dom.window.close()
}

{
  const { dom, result } = await createOn(newSessionPage({ composer: false }))
  const ok = !result.ok && /no composer/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  create refuses a page with no composer  (note=${result.note})`)
  dom.window.close()
}

{
  // Sent, but the page never became a session. Reporting success here would leave the daemon
  // holding a run that points nowhere, which is worse than a clean failure.
  const { dom, result } = await createOn(newSessionPage(), { becomesSession: null })
  const ok = !result.ok && /never became a session URL/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  create refuses when no session URL appears  (note=${result.note})`)
  dom.window.close()
}

{
  // A page already showing the wanted repo and branch: nothing to pick, and nothing clicked.
  const { dom, result } = await createOn(
    newSessionPage({ repoLabel: 'gemstack-land/the-framework', branchLabel: 'main' }),
  )
  const ok = result.ok && /already set to gemstack-land\/the-framework/.test(result.note) && /already set to main/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  create leaves an already-correct repo and branch alone  (note=${result.note})`)
  dom.window.close()
}

{
  // The exact-match guard: a repo whose name contains the branch text must not be mistaken for
  // the branch already being set, or the branch is never chosen at all.
  const { dom, result } = await createOn(
    newSessionPage({ repos: ['acme/domain-tools'], branches: ['main', 'dev'], repoLabel: 'acme/domain-tools' }),
    { repo: 'acme/domain-tools' },
  )
  const ok = result.ok && /branch: clicked "main"/.test(result.note)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  a repo name containing the branch text does not skip the branch  (note=${result.note})`)
  dom.window.close()
}

{
  // The probe reads and reports; it must not open a menu or fill anything, because it is what
  // runs first against a page nobody has inspected yet.
  const dom = new JSDOM(`<!doctype html><html><body><main>${newSessionPage()}</main></body></html>`, {
    url: 'https://claude.ai/code',
    runScripts: 'outside-only',
  })
  dom.window.eval(script)
  const report = dom.window.__tfBridgeProbeNewSession()
  const hidden = [...dom.window.document.querySelectorAll('[role="option"]')].every(
    el => el.getAttribute('aria-hidden') === 'true',
  )
  const typed = dom.window.document.querySelector('[contenteditable="true"]').textContent
  const ok =
    report.composer === 'contenteditable' &&
    report.sendButton === true &&
    report.sessionId === null &&
    report.triggers.some(t => /Select repository/.test(t.text)) &&
    report.triggers.some(t => /Select branch/.test(t.text)) &&
    hidden &&
    typed === ''
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  probe describes the controls without touching them  (triggers=${report.triggers.length}, menusStillClosed=${hidden})`)
  dom.window.close()
}

console.log(failed ? `\n${failed} case(s) failed` : '\nall cases passed')
process.exit(failed ? 1 : 0)
