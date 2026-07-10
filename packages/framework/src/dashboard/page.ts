import { CLAUDE_CODE_SESSION_LINK } from '../events.js'

/**
 * The single self-contained dashboard page: HTML + inline CSS + inline JS, no
 * assets, no build step. The client opens an `EventSource` to `events` and
 * projects the {@link import('../events.js').FrameworkEvent} stream into panels
 * that foreground the orchestration (stack rationale, loop status, decisions)
 * beside a tail of the wrapped agent's own activity.
 */
export function dashboardHtml(title: string, stoppable = false, choiceable = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #0b0e14; color: #d7dce5; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 16px 20px;
    border-bottom: 1px solid #1c2230; }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: .2px; }
  header .sub { color: #7b8496; font-size: 12px; }
  header a { color: #6ea8fe; text-decoration: none; }
  header a:hover { text-decoration: underline; }
  #session-link { margin-left: auto; font-size: 12px; color: #7b8496; }
  #session-link code { color: #b7c0d0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  #status { font-size: 12px; color: #7b8496; }
  #stop { margin-left: 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    color: #f0a35e; background: #241a15; border: 1px solid #4a3320; border-radius: 6px;
    padding: 4px 12px; }
  #stop:hover { background: #2f2118; border-color: #6a4a2e; }
  #stop:disabled { opacity: .5; cursor: default; }
  #stop[hidden] { display: none; }
  #notify { margin-left: 12px; font: inherit; font-size: 13px; cursor: pointer; line-height: 1;
    color: #b7c0d0; background: #141a24; border: 1px solid #24344a; border-radius: 6px; padding: 4px 8px; }
  #notify:hover { background: #17212f; }
  #notify.on { border-color: #2f6f4a; background: #12241a; }
  #notify.denied { opacity: .5; cursor: not-allowed; }
  #app-banner { display: flex; align-items: center; gap: 8px; padding: 10px 20px;
    background: #0f2417; border-bottom: 1px solid #1c3a28; font-size: 13px; }
  #app-banner .dot { color: #67d98f; }
  #app-banner a { color: #67d98f; font-weight: 600; }
  #app-banner .run { color: #6f8a79; font-size: 12px; }
  #layout { display: flex; align-items: stretch; }
  #sidebar { flex: 0 0 240px; width: 240px; border-right: 1px solid #1c2230; padding: 14px 10px;
    overflow-y: auto; max-height: calc(100vh - 57px); }
  #sidebar h2 { margin: 0 0 8px; padding: 0 6px; font-size: 12px; text-transform: uppercase;
    letter-spacing: .8px; color: #7b8496; font-weight: 600; }
  #runs li { padding: 8px; border-bottom: 1px solid #161b26; cursor: pointer; border-radius: 6px; }
  #runs li:hover { background: #141a24; }
  #runs li.active { background: #17212f; }
  #runs .r-intent { color: #d7dce5; font-size: 13px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  #runs .r-meta { color: #7b8496; font-size: 11px; margin-top: 3px; display: flex; align-items: center; gap: 6px; }
  #runs .dot { font-size: 9px; }
  #runs .st-done { color: #67d98f; }
  #runs .st-failed { color: #e2686a; }
  #runs .st-stopped { color: #f0a35e; }
  #runs .st-running { color: #6ea8fe; }
  #runs .empty { color: #5c657a; font-size: 12px; padding: 6px; cursor: default; }
  #runs .empty:hover { background: none; }
  #viewing { display: none; align-items: center; gap: 8px; padding: 8px 20px; font-size: 12px;
    background: #16202e; border-bottom: 1px solid #24344a; color: #9db4d6; }
  #viewing.on { display: flex; }
  #viewing button { font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; color: #6ea8fe;
    background: #0f1722; border: 1px solid #24344a; border-radius: 6px; padding: 3px 10px; }
  #content { flex: 1; min-width: 0; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 18px 20px; max-width: 1100px; }
  section { background: #10141d; border: 1px solid #1c2230; border-radius: 10px; padding: 14px 16px; }
  section h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase;
    letter-spacing: .8px; color: #7b8496; font-weight: 600; }
  .stack { font-size: 15px; font-weight: 600; color: #e8ecf3; margin-bottom: 8px; }
  ul { margin: 0; padding-left: 0; list-style: none; }
  li { padding: 6px 0; border-bottom: 1px solid #161b26; }
  li:last-child { border-bottom: 0; }
  .choice { color: #e8ecf3; }
  .why { color: #8b93a3; font-size: 13px; }
  #rationale { margin-top: 10px; }
  #rationale .rat-group { margin-top: 8px; }
  #rationale .rat-label { font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
    color: #7b8496; font-weight: 600; margin-bottom: 4px; }
  #rationale .pro { color: #a9d6b6; font-size: 13px; padding: 2px 0; }
  #rationale .con { color: #d8b48a; font-size: 13px; padding: 2px 0; }
  #rationale .alt { color: #8b93a3; font-size: 13px; padding: 2px 0; }
  #rationale .alt b { color: #b7c0d0; font-weight: 600; }
  .pass-ok { color: #67d98f; }
  .pass-bad { color: #f0a35e; }
  .blocker { color: #f0a35e; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
    font-weight: 600; }
  .badge.grade { background: #14371f; color: #67d98f; }
  .badge.proto { background: #2a2320; color: #f0a35e; }
  #modes li { display: flex; align-items: center; gap: 8px; color: #b7c0d0; }
  #modes .box { color: #6ea8fe; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  #modes li.off { color: #5c657a; }
  #modes li.off .box { color: #3a4256; }
  /* Interactive plan-approval / choice panel (#304): full-width, accented so it
     reads as the one thing awaiting the human. */
  #choice-panel { grid-column: 1 / -1; background: #131a2a; border: 1px solid #2b3b5c;
    border-left: 3px solid #6ea8fe; border-radius: 10px; padding: 14px 18px; }
  #choice-panel[hidden] { display: none; }
  #choice-panel h2 { color: #9db4d6; }
  #choice-title { font-size: 15px; font-weight: 600; color: #e8ecf3; margin: 2px 0 10px; }
  #choice-options { margin-bottom: 12px; }
  #choice-options li { border-bottom: 0; padding: 4px 0; }
  #choice-options label { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
  #choice-options .opt-label { color: #e8ecf3; }
  #choice-options .opt-detail { color: #8b93a3; font-size: 12px; }
  #choice-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  #choice-accept { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: #0b0e14;
    background: #6ea8fe; border: 0; border-radius: 6px; padding: 6px 16px; }
  #choice-accept:hover { background: #8bbaff; }
  #autopilot-row { display: flex; align-items: center; gap: 6px; color: #b7c0d0; font-size: 13px; cursor: pointer; }
  #choice-count { color: #6ea8fe; font-size: 12px; }
  .kbd { color: #26324a; background: #aebfe0; border-radius: 4px; padding: 0 5px; font-size: 10px;
    font-weight: 700; margin-left: 4px; }
  #activity { grid-column: 1 / -1; }
  #log { font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #96a0b3;
    max-height: 320px; overflow-y: auto; white-space: pre-wrap; }
  .muted { color: #5c657a; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <span class="sub" id="session">connecting…</span>
  <span id="session-link"></span>
  <span id="status">●</span>
  <button id="notify" title="Notify me when a run finishes or needs my input">🔕</button>
  <button id="stop" hidden>■ Stop</button>
</header>
<div id="layout">
<aside id="sidebar">
  <h2>Runs</h2>
  <ul id="runs"><li class="empty">loading…</li></ul>
</aside>
<div id="content">
<div id="viewing">
  <span>Viewing a past run (read-only).</span>
  <button id="back-live">● Back to live</button>
</div>
<div id="app-banner" hidden>
  <span class="dot">▶</span>
  <span>Your app is running at <a id="app-link" href="#" target="_blank" rel="noopener">…</a></span>
  <span class="run">live until you stop the run</span>
</div>
<main>
  <section id="choice-panel" hidden>
    <h2>Your call</h2>
    <div id="choice-title"></div>
    <ul id="choice-options"></ul>
    <div id="choice-actions">
      <button id="choice-accept">Accept<span class="kbd">Ctrl+Enter</span></button>
      <label id="autopilot-row"><input type="checkbox" id="autopilot-toggle" /> autopilot</label>
      <span id="choice-count"></span>
    </div>
  </section>
  <section id="stack-panel">
    <h2>Stack &amp; rationale</h2>
    <div class="stack muted" id="stack">deciding…</div>
    <ul id="decisions"></ul>
    <div id="rationale"></div>
  </section>
  <section id="loop-panel">
    <h2>Loop status</h2>
    <div id="grade" class="muted">building…</div>
    <ul id="passes"></ul>
  </section>
  <section id="modes-panel" hidden>
    <h2>Modes</h2>
    <ul id="modes"></ul>
  </section>
  <section id="deploy-panel">
    <h2>Deploy</h2>
    <div id="deploy" class="muted">not decided yet</div>
  </section>
  <section id="ledger-panel">
    <h2>Decisions ledger</h2>
    <ul id="ledger"></ul>
  </section>
  <section id="activity">
    <h2>Agent activity</h2>
    <div id="log"></div>
  </section>
</main>
</div>
</div>
<script>
${clientScript(stoppable, choiceable)}
</script>
</body>
</html>`
}

function clientScript(stoppable: boolean, choiceable: boolean): string {
  // Runs in the browser. Keep it dependency-free.
  return `
const STOPPABLE = ${stoppable ? 'true' : 'false'};
const CHOICEABLE = ${choiceable ? 'true' : 'false'};
const AUTO_ACCEPT_MS = 10000;
const GENERIC_SESSION_LINK = ${JSON.stringify(CLAUDE_CODE_SESSION_LINK)};
let ended = false;
const $ = id => document.getElementById(id);
const log = line => {
  const el = $('log');
  el.textContent += (el.textContent ? '\\n' : '') + line;
  el.scrollTop = el.scrollHeight;
};
const decided = new Set();
function bootstrap(e) {
  switch (e.type) {
    case 'scope':
      $('session').textContent += '  ·  ' + e.scope + ': "' + e.intent + '"';
      break;
    case 'architect': {
      $('stack').textContent = e.stack; $('stack').classList.remove('muted');
      const ul = $('decisions'); ul.innerHTML = '';
      for (const d of e.decisions) {
        const li = document.createElement('li');
        li.innerHTML = '<div class="choice">' + esc(d.choice) + '</div><div class="why">' + esc(d.why) + '</div>';
        ul.appendChild(li);
      }
      renderRationale(e);
      break;
    }
    case 'checklist': {
      const li = document.createElement('li');
      li.className = e.passing ? 'pass-ok' : 'pass-bad';
      li.textContent = (e.passing ? '\\u2713' : '\\u2717') + ' pass ' + e.pass +
        (e.passing ? ': production-grade' : ': ' + e.blockers.join('; '));
      $('passes').appendChild(li);
      break;
    }
    case 'improve':
      log('\\u2192 improving: ' + e.blockers.join('; '));
      break;
    case 'deploy':
      $('deploy').textContent = e.plan.render.toUpperCase() + ' \\u2192 ' + e.plan.target + '  (' + e.plan.reason + ')';
      $('deploy').classList.remove('muted');
      break;
    case 'done': {
      const g = $('grade');
      g.classList.remove('muted');
      g.innerHTML = e.result.productionGrade
        ? '<span class="badge grade">production-grade</span> in ' + e.result.passes + ' pass(es)'
        : '<span class="badge proto">prototype</span>';
      // Reflect the recorded architecture choices as the ledger.
      const ul = $('ledger'); ul.innerHTML = '';
      for (const d of (e.result.plan?.decisions || [])) {
        const li = document.createElement('li');
        li.innerHTML = '<div class="choice">' + esc(d.choice) + '</div><div class="why">' + esc(d.why) + '</div>';
        ul.appendChild(li);
      }
      break;
    }
  }
}
function driver(e) {
  if (e.type === 'text') log('  ' + e.text.replace(/\\s+/g, ' ').trim().slice(0, 160));
  else if (e.type === 'action') log('  \\u00b7 ' + e.label);
  else if (e.type === 'error') log('  ! ' + e.message);
  else if (e.type === 'start') log('\\u203a prompt sent');
}
function renderRationale(e) {
  const el = $('rationale'); el.innerHTML = '';
  const group = (label, items, render) => {
    if (!items || !items.length) return;
    const wrap = document.createElement('div'); wrap.className = 'rat-group';
    const h = document.createElement('div'); h.className = 'rat-label'; h.textContent = label;
    wrap.appendChild(h);
    for (const it of items) { const row = document.createElement('div'); render(row, it); wrap.appendChild(row); }
    el.appendChild(wrap);
  };
  group('Why this stack', e.pros, (row, p) => { row.className = 'pro'; row.textContent = '\\u2713 ' + p; });
  group('Tradeoffs', e.cons, (row, c) => { row.className = 'con'; row.textContent = '\\u26a0 ' + c; });
  group('Considered instead', e.alternatives, (row, a) => {
    row.className = 'alt'; row.innerHTML = '<b>' + esc(a.option) + '</b> \\u2014 ' + esc(a.whyNot);
  });
}
function renderModes(all, active) {
  const on = new Set(active || []);
  const ul = $('modes'); ul.innerHTML = '';
  for (const m of (all || [])) {
    const checked = on.has(m);
    const li = document.createElement('li');
    if (!checked) li.className = 'off';
    li.innerHTML = '<span class="box">' + (checked ? '[x]' : '[ ]') + '</span> ' + esc(m);
    ul.appendChild(li);
  }
  $('modes-panel').hidden = false;
}
function setSessionLink(sessionId, sessionLink) {
  const el = $('session-link');
  if (sessionLink) {
    // The generic default is not a live per-run session (our runs are headless,
    // not Remote-Controlled), so label it honestly. A real --session-link keeps
    // "live session". Show the session id alongside when we know it.
    const generic = sessionLink === GENERIC_SESSION_LINK;
    const label = generic ? 'Open Claude Code' : 'live session';
    const idTail = sessionId ? ' <code>' + esc(sessionId) + '</code>' : '';
    el.innerHTML = '\\u25b6 <a href="' + esc(sessionLink) + '" target="_blank" rel="noopener">' + label + '</a>' + idTail;
    el.title = generic ? 'Generic Claude Code entry point, not a live session link' : (sessionId || '');
  } else if (sessionId) {
    el.innerHTML = 'session <code>' + esc(sessionId) + '</code>';
  }
}
function render(fe) {
  if (fe.kind === 'session') {
    let s = fe.fake ? 'fake driver' : fe.driver;
    s += '  in  ' + fe.workspace;
    $('session').textContent = s;
    if (fe.sessionLink) setSessionLink(undefined, fe.sessionLink);
    if (STOPPABLE && !ended && mode === 'live') $('stop').hidden = false;
  } else if (fe.kind === 'session-update') setSessionLink(fe.sessionId, fe.sessionLink);
  else if (fe.kind === 'preview') {
    const a = $('app-link');
    a.href = fe.url; a.textContent = fe.url;
    $('app-banner').hidden = false;
    log('\\u25b6 your app is running at ' + fe.url);
  }
  else if (fe.kind === 'bootstrap') bootstrap(fe.event);
  else if (fe.kind === 'driver') driver(fe.event);
  else if (fe.kind === 'modes') renderModes(fe.all, fe.active);
  else if (fe.kind === 'choice') showChoice(fe);
  else if (fe.kind === 'choice-resolved') resolveChoice(fe);
  else if (fe.kind === 'log') log(fe.message);
  else if (fe.kind === 'end') {
    if (mode === 'live') { ended = true; $('stop').hidden = true; }
    closeChoice();
    $('status').textContent = fe.ok ? '\\u25cf finished' : fe.stopped ? '\\u25a0 stopped' : '\\u25cf failed';
    notify(
      fe.ok ? '\\u2713 Run finished' : fe.stopped ? '\\u25a0 Run stopped' : '\\u2717 Run failed',
      fe.ok ? 'Your build is ready on the dashboard.' : fe.detail || '');
  }
}
function stopRun() {
  const btn = $('stop');
  btn.disabled = true;
  btn.textContent = 'stopping\\u2026';
  fetch('stop', { method: 'POST' }).catch(() => {});
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

// Interactive plan-approval / choice panel (#304). The run pauses on a 'choice'
// event; we render the options with the recommended one pre-selected, accept on
// click / Ctrl+Enter, and (when autopilot is on) auto-accept the recommended
// after a countdown that any mouse movement cancels. The pick is POSTed to
// /choice, which resolves the run; the run echoes a 'choice-resolved' back.
let activeChoice = null;
let choiceTimer = null;
let choiceLeft = 0;
function autopilotOn() {
  const v = localStorage.getItem('framework:autopilot');
  return v === null ? true : v === '1'; // default on, per the demo default
}
function showChoice(req) {
  // Live only: a past run's choices are already resolved (read-only history), and
  // if the server can't take a pick there is nothing to accept into.
  if (!CHOICEABLE || mode !== 'live') return;
  activeChoice = req;
  $('choice-title').textContent = req.title || 'Your call';
  const ul = $('choice-options'); ul.innerHTML = '';
  for (const o of (req.options || [])) {
    const li = document.createElement('li');
    const checked = o.id === req.recommended ? ' checked' : '';
    li.innerHTML = '<label><input type="radio" name="choice-opt" value="' + esc(o.id) + '"' + checked + '>' +
      '<span class="opt-label">' + esc(o.label) + '</span>' +
      (o.detail ? '<span class="opt-detail">' + esc(o.detail) + '</span>' : '') + '</label>';
    ul.appendChild(li);
  }
  $('autopilot-toggle').checked = autopilotOn();
  $('choice-panel').hidden = false;
  startCountdown();
  notify('The run needs your input', req.title || 'A choice is waiting for you.');
}
function selectedChoice() {
  const el = document.querySelector('input[name="choice-opt"]:checked');
  return el ? el.value : (activeChoice ? activeChoice.recommended : null);
}
function renderCount() {
  $('choice-count').textContent = '\\u25cf autopilot accepting in ' + choiceLeft + 's \\u2014 move the mouse to cancel';
}
function startCountdown() {
  stopCountdown();
  if (!autopilotOn() || !activeChoice) { $('choice-count').textContent = ''; return; }
  choiceLeft = Math.ceil((activeChoice.autoAcceptMs || AUTO_ACCEPT_MS) / 1000);
  renderCount();
  choiceTimer = setInterval(() => {
    choiceLeft -= 1;
    if (choiceLeft <= 0) { stopCountdown(); acceptChoice('autopilot'); }
    else renderCount();
  }, 1000);
}
function stopCountdown() { if (choiceTimer) { clearInterval(choiceTimer); choiceTimer = null; } }
function cancelAutopilot() {
  if (choiceTimer) { stopCountdown(); $('choice-count').textContent = 'autopilot canceled \\u2014 pick manually'; }
}
function acceptChoice(by) {
  if (!activeChoice) return;
  const id = activeChoice.id;
  const pick = selectedChoice();
  stopCountdown();
  activeChoice = null;
  $('choice-panel').hidden = true;
  fetch('choice', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id, pick: pick, by: by }) }).catch(() => {});
}
function resolveChoice(fe) {
  if (activeChoice && activeChoice.id === fe.id) {
    stopCountdown(); activeChoice = null; $('choice-panel').hidden = true;
  }
  log('\\u2713 chose ' + fe.picked + ' (' + fe.by + ')');
}
function closeChoice() { stopCountdown(); activeChoice = null; $('choice-panel').hidden = true; }

// Run history (#303): the live stream is one run; past runs come from /api/runs and
// replay through the very same render() into the panels. We keep every live event so
// "Back to live" can rebuild the current run without reconnecting.
let mode = 'live';
let activeRunId = null;
const liveEvents = [];

function resetPanels() {
  $('session').textContent = 'connecting\\u2026';
  $('session-link').innerHTML = '';
  $('status').textContent = '\\u25cf';
  $('stop').hidden = true;
  $('app-banner').hidden = true;
  $('stack').textContent = 'deciding\\u2026'; $('stack').classList.add('muted');
  $('decisions').innerHTML = ''; $('rationale').innerHTML = '';
  $('grade').textContent = 'building\\u2026'; $('grade').classList.add('muted');
  $('passes').innerHTML = '';
  $('modes-panel').hidden = true; $('modes').innerHTML = '';
  closeChoice();
  $('deploy').textContent = 'not decided yet'; $('deploy').classList.add('muted');
  $('ledger').innerHTML = '';
  $('log').textContent = '';
}

function project(events) {
  resetPanels();
  for (const e of events) { try { render(e); } catch {} }
}

function showLive() {
  mode = 'live'; activeRunId = null;
  $('viewing').classList.remove('on');
  project(liveEvents);
  markActive();
}

function showRun(id) {
  fetch('api/runs/' + encodeURIComponent(id)).then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    mode = 'history'; activeRunId = id;
    $('viewing').classList.add('on');
    project(data.events || []);
    markActive();
  }).catch(() => {});
}

function statusClass(s) {
  return s === 'done' ? 'st-done' : s === 'failed' ? 'st-failed'
    : s === 'stopped' ? 'st-stopped' : 'st-running';
}

function markActive() {
  for (const li of $('runs').children) li.classList.toggle('active', li.dataset && li.dataset.id === activeRunId);
}

function renderRuns(runs) {
  const ul = $('runs'); ul.innerHTML = '';
  if (!runs.length) { ul.innerHTML = '<li class="empty">No past runs yet.</li>'; return; }
  for (const r of runs) {
    const li = document.createElement('li');
    li.dataset.id = r.id;
    const when = new Date(r.startedAt).toLocaleString();
    const link = r.sessionLink ? ' \\u00b7 <a href="' + esc(r.sessionLink) + '" target="_blank" rel="noopener">session</a>' : '';
    li.innerHTML = '<div class="r-intent">' + esc(r.intent || 'untitled run') + '</div>' +
      '<div class="r-meta"><span class="dot ' + statusClass(r.status) + '">\\u25cf</span>' +
      '<span>' + esc(r.status) + '</span><span>\\u00b7 ' + esc(when) + '</span>' + link + '</div>';
    li.addEventListener('click', ev => {
      if (ev.target.tagName === 'A') return; // let the session link open
      showRun(r.id);
    });
    ul.appendChild(li);
  }
  markActive();
}

function loadRuns() {
  fetch('api/runs').then(r => r.ok ? r.json() : { runs: [] }).then(d => renderRuns(d.runs || [])).catch(() => {});
}

// Browser notifications (#309): tell the human when a run finishes or reaches a
// point that needs them (a <Choices> gate, e.g. a PLAN.md approval) while the tab
// is backgrounded. Opt-in via the header bell; the choice is remembered. Fully
// client-side and best-effort — a browser without the API just hides the bell.
const notifyBtn = $('notify');
const notifySupported = () => 'Notification' in window;
const notifyEnabled = () => localStorage.getItem('framework:notify') === '1';
function syncNotifyBtn() {
  if (!notifySupported()) { notifyBtn.hidden = true; return; }
  const denied = Notification.permission === 'denied';
  const on = notifyEnabled() && Notification.permission === 'granted';
  notifyBtn.classList.toggle('on', on);
  notifyBtn.classList.toggle('denied', denied);
  notifyBtn.textContent = on ? '\\uD83D\\uDD14' : '\\uD83D\\uDD15';
  notifyBtn.title = denied ? 'Notifications are blocked in your browser settings'
    : on ? 'Notifications on \\u2014 click to mute'
    : 'Notify me when a run finishes or needs my input';
}
async function toggleNotify() {
  if (!notifySupported() || Notification.permission === 'denied') return;
  if (notifyEnabled() && Notification.permission === 'granted') {
    localStorage.setItem('framework:notify', '0');
  } else {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    localStorage.setItem('framework:notify', perm === 'granted' ? '1' : '0');
  }
  syncNotifyBtn();
}
function notify(title, body) {
  // Live run only, opt-in + permitted, and only when the tab is backgrounded: if
  // the user is already looking at the dashboard the panels say it all.
  if (mode !== 'live' || !notifyEnabled() || !notifySupported()) return;
  if (Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body: body || '', tag: 'framework-run' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}
notifyBtn.addEventListener('click', toggleNotify);
syncNotifyBtn();

$('stop').addEventListener('click', stopRun);
$('back-live').addEventListener('click', showLive);
$('choice-accept').addEventListener('click', () => acceptChoice('user'));
$('autopilot-toggle').addEventListener('change', ev => {
  localStorage.setItem('framework:autopilot', ev.target.checked ? '1' : '0');
  if (ev.target.checked) startCountdown(); else { stopCountdown(); $('choice-count').textContent = 'autopilot off'; }
});
// Any mouse movement cancels the running autopilot countdown (cheap no-op once cleared).
document.addEventListener('mousemove', cancelAutopilot);
document.addEventListener('keydown', ev => {
  if (activeChoice && (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); acceptChoice('user'); }
});
const src = new EventSource('events');
src.onmessage = ev => {
  let fe; try { fe = JSON.parse(ev.data); } catch { return; }
  liveEvents.push(fe);
  if (mode === 'live') render(fe);
  // A finished run has just been archived; refresh the list so it appears.
  if (fe.kind === 'end') setTimeout(loadRuns, 1500);
};
src.onerror = () => { if (mode === 'live') $('status').textContent = '\\u25cb offline'; };
loadRuns();
setInterval(loadRuns, 10000);
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
