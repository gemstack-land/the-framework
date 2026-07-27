// The page half of the Claude web bridge (#1237): find the question a cloud session is parked
// on, and hand it to the service worker, which is the only part that talks to the daemon.
//
// The token and the fetch deliberately live in the worker, not here. A content script shares a
// tab with claude.ai, so nothing in this file should ever hold the secret that talks to a
// daemon, and a fetch from here would carry the page's origin into a CORS check the daemon
// refuses on purpose.
//
// Four rounds of a read-only spike shaped the extraction below, and each failure is worth
// keeping because each was a different obstacle:
//   1. the page has <code> blocks with no <pre>, so a `pre code` selector examined nothing
//   2. the message body sits behind shadow roots, so document.body.innerText never saw it
//   3. fixed prefixes guessed an indentation nobody promised, so brace matching replaced them
//   4. our own system prompt renders on the page, so its await-choices spec is a decoy
//
// `check.mjs` covers all four offline, in jsdom, with no browser and no live session.

const POLL_MS = 2000
/** So the scrape can exclude our own panel from what it mirrors. */
const PANEL_ID = 'tf-bridge-panel'
const IS_TOP = window.top === window

/** The cloud session this page is showing, which is the key the daemon joins runs on. */
function sessionIdFromUrl() {
  const match = /\/code\/(session_[A-Za-z0-9]+)/.exec(location.href)
  return match ? match[1] : undefined
}

/**
 * Hand a found question to the service worker, which owns the token and the fetch.
 *
 * Guarded on `chrome` existing so the offline harness (check.mjs) can run this file in jsdom,
 * where there is no extension runtime. Failures are swallowed: a page that cannot reach the
 * daemon must still show its panel rather than throw inside a DOM observer.
 */
/** What the daemon last said about our report, so the panel can say why nothing arrived. */
let bridgeStatus = 'not sent yet'

function reportToDaemon(parsed) {
  const sessionId = sessionIdFromUrl()
  if (!sessionId || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return
  const question = {
    sessionId,
    title: String(parsed.title ?? '').slice(0, 500),
    options: (parsed.options ?? [])
      .map(o => (typeof o === 'string' ? { label: o } : { label: String(o?.label ?? ''), ...(o?.detail ? { detail: String(o.detail).slice(0, 500) } : {}) }))
      .filter(o => o.label)
      .slice(0, 20),
    ...(parsed.recommended ? { recommended: String(parsed.recommended) } : {}),
  }
  if (!question.title || !question.options.length) return
  try {
    chrome.runtime.sendMessage({ type: 'tf-question', question }, reply => {
      // Silence here was the first thing to go wrong live: the worker answered "no token set"
      // and nobody ever saw it, so a configured-looking extension simply did nothing.
      if (chrome.runtime.lastError) bridgeStatus = chrome.runtime.lastError.message ?? 'worker unreachable'
      else if (!reply) bridgeStatus = 'no reply from the worker'
      else if (reply.ok) bridgeStatus = reply.skipped ? `sent (${reply.skipped})` : 'sent'
      else bridgeStatus = reply.error ?? 'failed'
    })
  } catch (err) {
    bridgeStatus = String(err?.message ?? err)
  }
}

/** What we last sent per position, so an unchanged message is not re-posted on every mutation. */
const sentEvents = new Map()

/** What happened to the last transcript report, for the panel. */
let transcriptStatus = 'not sent yet'

/**
 * The transcript, as message blocks (#1237).
 *
 * `article` is the anchor: the page reports one per message, which is a far better handle than
 * guessing at prose boundaries in a wall of text. Falling back to nothing rather than to a
 * heuristic is deliberate, because a wrong split would post gibberish that looks like output.
 */
function transcript() {
  const blocks = deepQueryAll('article')
    .map((el, index) => {
      const text = (el.innerText ?? el.textContent ?? '').trim()
      if (!text) return undefined
      // The composer lives in its own article on some layouts; an input-only block is not a
      // message.
      if (el.querySelector('[contenteditable="true"], textarea')) return undefined
      return { seq: index, role: 'agent', text: text.slice(0, 8000) }
    })
    .filter(Boolean)
  if (blocks.length) return blocks

  // No article blocks on this page, which is what a live session turned out to look like. Rather
  // than guess where one message ends and the next begins, mirror the page as a single block and
  // let it be replaced as it grows. Crude, but it is the honest shape: we know what is on screen,
  // not how it divides.
  //
  // Sliced from the END: the page opens with the rendered system prompt, so a head slice sent
  // 8000 characters of protocol spec and cut the session's actual activity off. The newest text
  // is the mirror's whole point.
  const text = pageText()
  return text ? [{ seq: 0, role: 'agent', text: text.slice(-8000) }] : []
}

/**
 * The conversation's text, without the rest of the application around it.
 *
 * Mirroring `body` sent the sidebar: "Home", "Code", "Artifacts", "Pinned", every nav label and
 * a run of icon-font glyphs. `main` is the conversation on this page, so it is preferred and the
 * body is only a last resort. Which one was used is reported, so a layout change shows up as a
 * container change rather than as mystery text.
 */
function conversation() {
  const main = deepQueryAll('main')[0] ?? deepQueryAll('[role="main"]')[0]
  return { el: main ?? document.body, via: main ? 'main' : 'body' }
}

/** Private-use codepoints are icon-font glyphs, which carry no meaning outside their font. */
const ICON_GLYPHS = /[\uE000-\uF8FF]/g

/** The session's own text, with our panel and the application chrome left out. */
function pageText() {
  const panel = document.getElementById(PANEL_ID)
  const hidden = panel?.style.display
  // Hide our own panel for the read, or the mirror would show the mirror.
  if (panel) panel.style.display = 'none'
  try {
    const { el } = conversation()
    return (el?.innerText ?? '')
      .replace(ICON_GLYPHS, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
  } finally {
    if (panel) panel.style.display = hidden ?? ''
  }
}

/**
 * Post whatever changed since the last look. Only what changed: the observer fires on every DOM
 * mutation and a session's transcript is mostly stable, so sending it all each time would be a
 * few hundred kilobytes a second for no new information.
 */
/**
 * Tell the daemon what this injected script is and what it just saw.
 *
 * Diagnosis kept requiring a screenshot of the panel, so every wrong guess cost a round trip
 * through a person. This says it directly: which version is running in the page, and what the
 * last scrape found.
 */
function sayHello(sessionId, note) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return
  const version = chrome.runtime.getManifest?.().version ?? '?'
  try {
    chrome.runtime.sendMessage({ type: 'tf-hello', sessionId, version, note }, () => void chrome.runtime.lastError)
  } catch {
    // Nothing to do; the next pass tries again.
  }
}

function reportTranscript() {
  const sessionId = sessionIdFromUrl()
  if (!sessionId || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return
  const blocks = transcript()
  sayHello(sessionId, `articles ${deepQueryAll('article').length}, via ${conversation().via}, blocks ${blocks.length}, ${transcriptStatus}`)
  const events = blocks.filter(event => sentEvents.get(event.seq) !== event.text)
  if (!blocks.length) {
    transcriptStatus = 'no <article> blocks found'
    return
  }
  if (!events.length) {
    transcriptStatus = `${blocks.length} block(s), unchanged`
    return
  }
  try {
    chrome.runtime.sendMessage({ type: 'tf-events', sessionId, events }, reply => {
      if (chrome.runtime.lastError) {
        transcriptStatus = chrome.runtime.lastError.message ?? 'worker unreachable'
        return
      }
      // Only remember what the daemon actually took, so a rejected batch is retried.
      if (reply?.ok) {
        for (const event of events) sentEvents.set(event.seq, event.text)
        transcriptStatus = `sent ${events.length} of ${blocks.length} block(s)`
      } else {
        transcriptStatus = reply?.error ?? 'failed'
      }
    })
  } catch {
    // Worker asleep or context invalidated; the next mutation retries.
  }
}

/** Every element matching a selector, including inside open shadow roots. */
function deepQueryAll(selector, root = document, seen = new Set()) {
  const out = [...root.querySelectorAll(selector)]
  for (const el of root.querySelectorAll('*')) {
    if (!el.shadowRoot || seen.has(el)) continue
    seen.add(el)
    out.push(...deepQueryAll(selector, el.shadowRoot, seen))
  }
  return out
}

/** How many open shadow roots exist, which tells us whether that is where content hides. */
function countShadowRoots(root = document, seen = new Set()) {
  let n = 0
  for (const el of root.querySelectorAll('*')) {
    if (!el.shadowRoot || seen.has(el)) continue
    seen.add(el)
    n += 1 + countShadowRoots(el.shadowRoot, seen)
  }
  return n
}

/** Page text including shadow content, which plain body.innerText misses. */
function deepText() {
  let text = document.body?.innerText ?? ''
  for (const host of deepQueryAll('*')) {
    if (host.shadowRoot) text += `\n${host.shadowRoot.textContent ?? ''}`
  }
  return text
}

/**
 * Our own await-protocol spec is part of the system prompt, and the page renders the prompt,
 * so a session shows a JSON block with `options` before the agent has asked anything. Its
 * values are the spec's placeholders. Round 3 extracted exactly that and reported
 * `<the question>` as the question, which is the decoy working as designed.
 */
function isTemplate(parsed) {
  const placeholder = v => typeof v === 'string' && /^<.*>$/.test(v.trim())
  if (placeholder(parsed.title)) return true
  const labels = parsed.options.map(o => (typeof o === 'string' ? o : o?.label))
  return labels.length > 0 && labels.every(placeholder)
}

/** Every JSON object carrying `options` in the text, in the order they appear. */
function extractChoices(text, stats) {
  const found = []
  collectChoices(text, stats, found)
  return found
}

/**
 * Brace-match every `options` object out of arbitrary surrounding text.
 *
 * Round 2 reached the text but could not read it, because matching on the fixed prefixes
 * `{"title"` and `{\n  "title"` guesses at an indentation nobody promised, and the block
 * arrives with prose around it. Strings and escapes are tracked so a brace inside a label
 * cannot close the object early.
 */
function collectChoices(text, stats, found) {
  if (!text.includes('"options"')) return found
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth > 0) continue
        const slice = text.slice(i, j + 1)
        if (slice.includes('"options"')) {
          if (stats) stats.candidates++
          try {
            const parsed = JSON.parse(slice)
            if (Array.isArray(parsed.options)) {
              found.push(parsed)
              // Keep scanning past this object: the spec comes first and the real question
              // after it, so the last one is the one that matters.
              i = j
            } else if (stats) stats.parsedWithoutOptions++
          } catch (err) {
            // Not this one, or still streaming. Record why, so a failing report says whether
            // the block was never found or found and unparseable.
            if (stats) {
              stats.parseErrors++
              stats.lastError = String(err.message ?? err).slice(0, 80)
            }
          }
        }
        break
      }
    }
  }
  return found
}

/**
 * The question a parked run is waiting on. Our agents emit it as a fenced JSON block carrying
 * `options`. Element-scoped first so the winner names where it was found, then the whole page
 * as a fallback for a block split across elements by a syntax highlighter.
 */
function findPendingChoice() {
  // `code` on its own: the page has <code> blocks with no <pre> wrapper (round 1), and they
  // sit inside shadow roots (round 2). DOM order tracks transcript order, so the last real
  // question wins over both the spec and any earlier answered one.
  const fromElements = []
  for (const el of deepQueryAll('pre code, pre, code')) {
    for (const parsed of extractChoices(el.textContent ?? '')) {
      fromElements.push({ via: el.tagName.toLowerCase(), parsed })
    }
  }
  const candidates = fromElements.length
    ? fromElements
    : extractChoices(deepText()).map(parsed => ({ via: 'page-text', parsed }))
  const real = candidates.filter(c => !isTemplate(c.parsed))
  const found = real.at(-1)
  if (found) reportToDaemon(found.parsed)
  reportTranscript()
  return found ?? undefined
}

/** The box an answer would be typed into, if this ever becomes two-way. */
function findComposer() {
  const editable = deepQueryAll('div[contenteditable="true"]')[0]
  if (editable) return { via: 'contenteditable', el: editable }
  const textarea = deepQueryAll('textarea')[0]
  if (textarea) return { via: 'textarea', el: textarea }
  return undefined
}

/** What the last delivery attempt did, for the panel. */
let answerStatus = 'none delivered'

/** Put text in the composer. execCommand is what the live page accepts; jsdom has no such thing. */
function fillComposer(composer, text) {
  if (composer.via === 'textarea') {
    composer.el.value = text
    composer.el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  composer.el.focus()
  let inserted = false
  try {
    inserted = document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (!inserted) {
    // The offline harness lands here; a real ProseMirror/Lexical editor may ignore it, which the
    // submit check below would surface as an empty send.
    composer.el.textContent = text
    composer.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  return true
}

/** The button that sends the composer, wherever the page keeps it this week. */
function findSendButton() {
  const labelled = deepQueryAll('button[aria-label]').filter(
    b => /send/i.test(b.getAttribute('aria-label') ?? '') && !b.disabled,
  )
  // The last one: pages render hidden or historical buttons above the live composer's.
  return labelled.at(-1) ?? deepQueryAll('button[type="submit"]').at(-1)
}

/**
 * Type the dashboard's pick into the composer and submit it (#1237).
 *
 * This is the one place the extension acts rather than observes, so it reports exactly what it
 * did: which fill path, and whether the send was a button click or an Enter fallback. The text
 * only ever comes from the daemon, which only accepts a label of the parked question, so what
 * can be typed here is bounded by what the session itself offered.
 */
async function deliverAnswer(text) {
  // Wait for the composer rather than failing on its absence: the first live delivery landed
  // right after a tab revive, and claude.ai takes well over the naive 5 seconds to render, so
  // "no composer on the page" mostly means "not yet". The harness shortens the wait.
  const deadline = Date.now() + (window.__tfComposerWaitMs ?? 20000)
  let composer = findComposer()
  while (!composer && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500))
    composer = findComposer()
  }
  if (!composer) {
    answerStatus = 'failed: no composer on the page'
    return { ok: false, note: 'no composer on the page' }
  }
  fillComposer(composer, text)
  // Let the editor's own event handling settle before submitting, or the click sends nothing.
  await new Promise(resolve => setTimeout(resolve, 400))
  const button = findSendButton()
  if (button) {
    button.click()
    answerStatus = `sent via ${composer.via} + button`
    return { ok: true, note: `filled ${composer.via}, clicked send button` }
  }
  for (const type of ['keydown', 'keyup']) {
    composer.el.dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
    )
  }
  answerStatus = `sent via ${composer.via} + enter`
  return { ok: true, note: `filled ${composer.via}, no send button, sent Enter` }
}

// ---------------------------------------------------------------------------
// Creating a session (#1328).
//
// A session created through this page with the repo picker is repo-bound, and those are the ones
// that can push and open a PR; `claude --cloud` produces a bundle upload that cannot (#1320).
// So the daemon queues a repo, a branch and a prompt, and this drives the same three controls a
// person would: pick the repo, pick the branch, type the prompt, send.
//
// **Every selector here is a guess about someone else's UI**, which is the whole risk. So this
// half is built to report rather than to insist: `probeNewSession` describes what it can see
// without touching anything, and every failure below names the control it could not find. The
// first live run is expected to be a probe, not a success.

/** Visible text of a control, trimmed and collapsed, for matching menu entries. */
function controlText(el) {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Whether a control is actually usable: rendered, enabled, not aria-hidden. */
function usable(el) {
  if (!el || el.disabled) return false
  if (el.getAttribute?.('aria-hidden') === 'true') return false
  return true
}

/**
 * Everything on the page that behaves like a dropdown trigger.
 *
 * Several strategies rather than one selector because the page is not ours and the markup for a
 * picker varies: an ARIA combobox, a menu/listbox button, or a plain button whose label happens
 * to name a repo. Ordered from most explicit to least, so a confident match wins.
 */
function menuTriggers() {
  const out = []
  const add = (el, via) => {
    if (usable(el) && !out.some(entry => entry.el === el)) out.push({ el, via, text: controlText(el) })
  }
  for (const el of deepQueryAll('[role="combobox"]')) add(el, 'combobox')
  for (const el of deepQueryAll('button[aria-haspopup="listbox"], button[aria-haspopup="menu"], button[aria-haspopup="true"]')) add(el, 'haspopup')
  for (const el of deepQueryAll('button[aria-expanded]')) add(el, 'expandable')
  for (const el of deepQueryAll('button')) add(el, 'button')
  return out
}

/** Options currently on offer in an open menu. */
function menuOptions() {
  return deepQueryAll('[role="option"], [role="menuitem"], [role="menuitemradio"]')
    .filter(usable)
    .map(el => ({ el, text: controlText(el) }))
}

/** Wait for `read` to return something truthy, or give up. */
async function waitFor(read, timeoutMs, stepMs = 150) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() >= deadline) return undefined
    await new Promise(resolve => setTimeout(resolve, stepMs))
  }
}

/** How long to wait for a menu to render, and for the page to become a session. */
const MENU_WAIT_MS = 6000

/**
 * Open the picker whose current label best matches `hint`, then choose the entry matching `want`.
 *
 * Matching is exact-then-contains, case-insensitive, and a repo is also matched on its bare name
 * so `owner/name` finds an entry rendered as just `name`. Returns a note either way; the caller
 * turns that into the daemon-visible reason.
 */
async function pickFromMenu(hint, want, wantAliases = []) {
  const wanted = [want, ...wantAliases].map(t => t.toLowerCase()).filter(Boolean)
  const matches = text => {
    const lower = text.toLowerCase()
    return wanted.some(w => lower === w) || wanted.some(w => lower.includes(w))
  }

  // Already showing what we want (the page may default to it): nothing to do.
  const showing = menuTriggers().find(trigger => matches(trigger.text))
  if (showing) return { ok: true, note: `${hint} already set to ${showing.text}` }

  const hintLower = hint.toLowerCase()
  const candidates = menuTriggers().filter(trigger => trigger.text.toLowerCase().includes(hintLower))
  const triggers = candidates.length ? candidates : menuTriggers()
  for (const trigger of triggers.slice(0, 8)) {
    trigger.el.click()
    const options = await waitFor(() => {
      const found = menuOptions()
      return found.length ? found : undefined
    }, MENU_WAIT_MS)
    if (!options) continue
    const hit = options.find(option => matches(option.text))
    if (hit) {
      hit.el.click()
      return { ok: true, note: `${hint}: clicked "${hit.text}" via ${trigger.via}` }
    }
    // Wrong menu: shut it again so the next trigger is not clicked through an overlay.
    trigger.el.click()
  }
  return { ok: false, note: `${hint}: no menu offered "${want}"` }
}

/**
 * Describe the controls on this page without touching any of them (#1328).
 *
 * The point is a productive first round trip: rather than "it did not work", this says what the
 * page actually offers, so the selectors above can be aimed at the real markup. Text only, capped,
 * so the report is safe to paste into an issue.
 */
function probeNewSession() {
  return {
    url: location.href,
    sessionId: sessionIdFromUrl() ?? null,
    composer: findComposer()?.via ?? null,
    sendButton: Boolean(findSendButton()),
    triggers: menuTriggers()
      .slice(0, 40)
      .map(trigger => ({ via: trigger.via, text: trigger.text.slice(0, 80) }))
      .filter(trigger => trigger.text),
    openOptions: menuOptions()
      .slice(0, 40)
      .map(option => option.text.slice(0, 80)),
  }
}

/**
 * Drive the new-session flow: repo, branch, prompt, send, and report the session it became.
 *
 * The session id is read from the URL rather than from anything on the page, because that is the
 * one thing claude.ai is guaranteed to tell us and it is exactly what the daemon joins runs on.
 * A send that never becomes a session URL is a failure with a reason, never a silent success:
 * the daemon would otherwise record a run pointing nowhere.
 */
async function createSession({ repo, branch, prompt }) {
  const composerWait = window.__tfComposerWaitMs ?? 20000
  const composer = await waitFor(findComposer, composerWait)
  if (!composer) return { ok: false, note: 'no composer on the new-session page' }

  const bareRepo = String(repo).split('/').pop() ?? repo
  const repoPick = await pickFromMenu('repository', repo, [bareRepo])
  if (!repoPick.ok) return { ok: false, note: repoPick.note }
  // The branch list usually reloads once a repo is chosen; asking too early reads the old one.
  await new Promise(resolve => setTimeout(resolve, window.__tfMenuSettleMs ?? 800))
  const branchPick = await pickFromMenu('branch', branch)
  if (!branchPick.ok) return { ok: false, note: branchPick.note }

  fillComposer(composer, prompt)
  await new Promise(resolve => setTimeout(resolve, 400))
  const button = findSendButton()
  if (button) button.click()
  else {
    for (const type of ['keydown', 'keyup']) {
      composer.el.dispatchEvent(
        new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      )
    }
  }

  const sessionId = await waitFor(sessionIdFromUrl, window.__tfSessionWaitMs ?? 60000, 500)
  if (!sessionId) return { ok: false, note: `sent, but the page never became a session URL (${repoPick.note}; ${branchPick.note})` }
  return { ok: true, sessionId, note: `${repoPick.note}; ${branchPick.note}; sent via ${button ? 'button' : 'enter'}` }
}

// The worker hands answers to the top frame only: the composer lives there, and a child frame
// answering too would submit twice.
if (IS_TOP && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'tf-probe-newsession') {
      sendResponse(probeNewSession())
      return true
    }
    if (message?.type === 'tf-create-session' && message.start) {
      void createSession(message.start)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, note: String(err?.message ?? err) }))
      return true
    }
    if (message?.type !== 'tf-deliver-answer' || typeof message.text !== 'string') return false
    void deliverAnswer(message.text)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, note: String(err?.message ?? err) }))
    return true
  })
}

// The offline harness (check.mjs) runs this file in jsdom, where there is no extension runtime
// to hand answers through. Exposed only there: on a real page `chrome` exists and nothing is
// added to the window claude.ai can see.
if (typeof chrome === 'undefined') {
  window.__tfBridgeDeliverAnswer = deliverAnswer
  window.__tfBridgeCreateSession = createSession
  window.__tfBridgeProbeNewSession = probeNewSession
}

/**
 * What the page looks like when extraction fails. Structure and lengths only, never message
 * text, so the report stays safe to paste into a public issue.
 */
function diagnostics() {
  const codes = deepQueryAll('pre, code')
    .map(el => (el.textContent ?? '').trim())
    .filter(t => t.includes('"options"') || t.startsWith('{'))
  const frames = [...document.querySelectorAll('iframe')]
  let reachableFrames = 0
  for (const f of frames) {
    try {
      if (f.contentDocument?.body) reachableFrames++
    } catch {
      // Cross origin, which is itself the answer.
    }
  }
  const deep = deepText()
  // Did the brace matcher find object-shaped candidates, and did any fail to parse? This is
  // what separates "never found it" from "found it and could not read it".
  const stats = { candidates: 0, parseErrors: 0, parsedWithoutOptions: 0, lastError: '' }
  const all = extractChoices(deep, stats)
  return {
    frame: IS_TOP ? 'top' : 'child',
    jsonCandidates: stats.candidates,
    jsonObjects: all.length,
    jsonTemplates: all.filter(isTemplate).length,
    jsonParseErrors: stats.parseErrors,
    jsonLastError: stats.lastError,
    pre: deepQueryAll('pre').length,
    code: deepQueryAll('code').length,
    jsonishBlocks: codes.length,
    shadowRoots: countShadowRoots(),
    iframes: frames.length,
    reachableFrames,
    contentEditables: deepQueryAll('div[contenteditable="true"]').length,
    textareas: deepQueryAll('textarea').length,
    // The decisive pair: does the block exist in the top body, and does it exist once
    // shadow content is included?
    optionsInBodyText: (document.body?.innerText ?? '').includes('"options"'),
    optionsInDeepText: deep.includes('"options"'),
    deepTextLength: deep.length,
  }
}

function survey() {
  const choice = findPendingChoice()
  const composer = findComposer()
  return {
    url: location.href,
    choiceFound: Boolean(choice),
    choiceVia: choice?.via,
    choiceTitle: choice?.parsed?.title,
    choiceOptions: (choice?.parsed?.options ?? []).map(o => o.label ?? o),
    composerFound: Boolean(composer),
    composerVia: composer?.via,
    diagnostics: diagnostics(),
  }
}

// A child frame has no panel of its own: it reports upward, so the top frame's report says
// whether the content was in a frame and which one. This is what settles the iframe question.
if (!IS_TOP) {
  const send = () => {
    const s = survey()
    if (s.choiceFound || s.diagnostics.jsonishBlocks || s.diagnostics.optionsInDeepText) {
      parent.postMessage({ __tfBridge: s }, '*')
    }
  }
  send()
  watch(send)
} else {
  let fromFrame
  window.addEventListener('message', e => {
    if (e.data && typeof e.data === 'object' && e.data.__tfBridge) fromFrame = e.data.__tfBridge
  })

  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.style.cssText = [
    'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
    'width:360px', 'max-height:70vh', 'overflow:auto',
    'background:#1f2430', 'color:#dbdbdb', 'font:12px/1.45 ui-monospace,monospace',
    'border:1px solid #3a4150', 'border-radius:8px', 'padding:10px 12px',
    'box-shadow:0 6px 24px rgba(0,0,0,.35)',
  ].join(';')
  document.documentElement.appendChild(panel)

  let latest = survey()

  const button = (label, onClick) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'margin-top:8px;width:100%;padding:5px;cursor:pointer;background:#2d3441;color:#dbdbdb;border:1px solid #3a4150;border-radius:5px;font:inherit'
    b.addEventListener('click', onClick)
    return b
  }

  const render = () => {
    const top = survey()
    // A child frame's find wins: it means the content lives there, which is the finding.
    latest = { ...top, fromFrame: fromFrame ?? null }
    const winner = top.choiceFound ? top : fromFrame?.choiceFound ? fromFrame : top
    const d = top.diagnostics
    const rows = [
      ['question found', winner.choiceFound ? `yes (${winner.choiceVia}${winner === fromFrame ? ', in iframe' : ''})` : 'no'],
      ['title', winner.choiceTitle ?? '-'],
      ['options', winner.choiceOptions?.length ? winner.choiceOptions.join(' | ') : '-'],
      ['composer', top.composerFound ? top.composerVia : 'not found'],
      ['bridge', bridgeStatus],
      ['answer', answerStatus],
      // Always shown: the transcript is the half that runs even when no question was asked, so
      // it needs its own line rather than sharing the question's.
      ['transcript', transcriptStatus],
      ['articles', deepQueryAll('article').length],
    ]
    if (!winner.choiceFound) {
      rows.push(
        ['code / pre', `${d.code} / ${d.pre}`],
        ['shadow roots', d.shadowRoots],
        ['iframes', `${d.iframes} (reachable ${d.reachableFrames})`],
        ['"options" body', String(d.optionsInBodyText)],
        ['"options" deep', String(d.optionsInDeepText)],
        ['json candidates', `${d.jsonCandidates} (parse errors ${d.jsonParseErrors})`],
        ...(d.jsonLastError ? [['last parse error', d.jsonLastError]] : []),
        ['frame reported', fromFrame ? 'yes' : 'no'],
      )
    }
    panel.innerHTML = ''
    const head = document.createElement('div')
    const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '?'
    head.textContent = `The Framework bridge v${version}`
    head.style.cssText = 'font-weight:600;margin-bottom:6px;color:#a7c080'
    panel.appendChild(head)
    for (const [k, v] of rows) {
      const line = document.createElement('div')
      line.style.cssText = 'display:flex;gap:8px;margin:2px 0'
      const key = document.createElement('span')
      key.style.cssText = 'color:#7f8797;min-width:104px;flex:none'
      key.textContent = k
      const val = document.createElement('span')
      val.style.cssText = 'word-break:break-word'
      val.textContent = String(v)
      line.append(key, val)
      panel.appendChild(line)
    }
    panel.appendChild(button('Copy report', () => {
      void navigator.clipboard.writeText(JSON.stringify(latest, null, 2))
    }))
    // Fills without submitting, on purpose: it proves the write path exists without the
    // extension ever speaking for the user.
    panel.appendChild(button('Fill composer (does not send)', () => {
      const composer = findComposer()
      if (!composer) return
      const text = winner.choiceOptions?.[0] ?? 'test'
      if (composer.via === 'textarea') {
        composer.el.value = text
        composer.el.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        composer.el.focus()
        document.execCommand('insertText', false, text)
      }
    }))
  }

  render()
  watch(render)
}

/**
 * Re-survey when the page actually changes, plus a slow heartbeat.
 *
 * Not a fast `setInterval`: this is designed to run in a background tab, and Chrome clamps timers
 * in a tab hidden for more than about five minutes to roughly once a minute. The session's own
 * stream mutates the DOM whenever anything happens, so an observer catches it immediately and the
 * interval is only a backstop for a mutation we failed to see.
 */
function watch(run) {
  let queued = false
  let interval
  // Reloading the extension invalidates this script's runtime but leaves it running in the tab,
  // where every chrome.* call now throws. Those throws land on the extension's error page and
  // read as bugs, so a dead context stops watching instead of erroring once a minute forever.
  const alive = () => {
    try {
      if (typeof chrome === 'undefined' || chrome.runtime?.id) return true
    } catch {
      // Reading chrome.runtime itself can throw once the context is gone.
    }
    observer.disconnect()
    clearInterval(interval)
    return false
  }
  const observer = new MutationObserver(() => {
    if (queued || !alive()) return
    queued = true
    setTimeout(() => {
      queued = false
      run()
    }, 250)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  interval = setInterval(() => {
    if (alive()) run()
  }, 30 * POLL_MS)
}
