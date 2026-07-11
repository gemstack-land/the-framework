import { CLAUDE_CODE_SESSION_LINK } from '../events.js'
import { renderResearchPrompt } from '../research-preset.js'
import { renderReadabilityPrompt } from '../readability-preset.js'
import { renderMaintainabilityPrompt } from '../maintainability-preset.js'

/**
 * The single self-contained dashboard page: HTML + inline CSS + inline JS, no
 * assets, no build step. The client opens an `EventSource` to `events` and
 * projects the {@link import('../events.js').FrameworkEvent} stream into panels
 * that foreground the orchestration (stack rationale, loop status, decisions)
 * beside a tail of the wrapped agent's own activity.
 */
export function dashboardHtml(title: string, stoppable = false, choiceable = false, startable = false): string {
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
  /* Start-a-run panel (#345): only the daemon dashboard wires /api/start; the
     per-run page and the relay render it hidden. */
  #start-panel { grid-column: 1 / -1; }
  #start-panel[hidden] { display: none; }
  #start-prompt { width: 100%; min-height: 60px; resize: vertical; font: inherit; color: #e8ecf3;
    background: #0d1119; border: 1px solid #24344a; border-radius: 8px; padding: 8px 10px; }
  #start-prompt:focus { outline: none; border-color: #3d5a8a; }
  #start-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
  #start-run { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: #0b0e14;
    background: #6ea8fe; border: 0; border-radius: 6px; padding: 6px 16px; }
  #start-run:hover { background: #8bbaff; }
  #start-run:disabled { opacity: .5; cursor: default; }
  .start-preset { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: #b7c0d0;
    background: #141a24; border: 1px solid #24344a; border-radius: 6px; padding: 6px 14px; }
  .start-preset:hover { background: #17212f; }
  .start-preset:disabled { opacity: .5; cursor: default; }
  #start-note { color: #f0a35e; font-size: 12px; }
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
  /* Approve/Decline confirmation buttons (#358): shown instead of the option list. */
  #choice-approve { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: #0b0e14;
    background: #4cc38a; border: 0; border-radius: 6px; padding: 6px 16px; }
  #choice-approve:hover { background: #6fd6a5; }
  #choice-approve[hidden], #choice-decline[hidden], #choice-accept[hidden] { display: none; }
  #choice-decline { font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: #fff;
    background: #e5484d; border: 0; border-radius: 6px; padding: 6px 16px; }
  #choice-decline:hover { background: #f2555a; }
  #choice-file { color: #8b93a3; font-size: 12px; margin: -4px 0 10px; }
  #choice-file[hidden] { display: none; }
  #autopilot-row { display: flex; align-items: center; gap: 6px; color: #b7c0d0; font-size: 13px; cursor: pointer; }
  #choice-count { color: #6ea8fe; font-size: 12px; }
  .kbd { color: #26324a; background: #aebfe0; border-radius: 4px; padding: 0 5px; font-size: 10px;
    font-weight: 700; margin-left: 4px; }
  #activity { grid-column: 1 / -1; }
  #log { font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #96a0b3;
    max-height: 320px; overflow-y: auto; white-space: pre-wrap; }
  .muted { color: #5c657a; }
  /* Document sidebar (#319): the PLAN.md / TODO.md the agent writes, rendered
     beside the run with a sticky tab nav. Hidden until a doc exists. */
  #docs { flex: 0 0 340px; width: 340px; border-left: 1px solid #1c2230;
    overflow-y: auto; max-height: calc(100vh - 57px); }
  #docs[hidden] { display: none; }
  #docs-nav { position: sticky; top: 0; display: flex; gap: 4px; padding: 10px 12px;
    background: #0b0e14; border-bottom: 1px solid #1c2230; }
  .doc-tab { font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; color: #7b8496;
    background: #10141d; border: 1px solid #1c2230; border-radius: 6px; padding: 4px 10px; }
  .doc-tab:hover { color: #b7c0d0; }
  .doc-tab.active { color: #e8ecf3; background: #17212f; border-color: #24344a; }
  #docs-body { padding: 4px 16px 24px; font-size: 13px; color: #c3cad6; line-height: 1.6; }
  #docs-body h1, #docs-body h2, #docs-body h3, #docs-body h4 { color: #e8ecf3; line-height: 1.3;
    margin: 16px 0 8px; }
  #docs-body h1 { font-size: 17px; } #docs-body h2 { font-size: 15px; } #docs-body h3 { font-size: 13px; }
  #docs-body p { margin: 8px 0; }
  #docs-body ul, #docs-body ol { margin: 8px 0; padding-left: 20px; list-style: revert; }
  #docs-body li { padding: 2px 0; border-bottom: 0; }
  #docs-body li.task { list-style: none; margin-left: -20px; }
  #docs-body li.task input { margin-right: 6px; }
  #docs-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    background: #161b26; color: #b7c0d0; padding: 1px 5px; border-radius: 4px; }
  #docs-body pre { background: #0f141d; border: 1px solid #1c2230; border-radius: 8px;
    padding: 10px 12px; overflow-x: auto; }
  #docs-body pre code { background: none; padding: 0; color: #96a0b3; }
  #docs-body a { color: #6ea8fe; text-decoration: none; }
  #docs-body a:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <span class="sub" id="session">connecting…</span>
  <span id="session-link"></span>
  <span class="sub" id="spend" title="Cumulative agent spend for this run" hidden></span>
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
  <section id="start-panel"${startable ? '' : ' hidden'}>
    <h2>Start a run</h2>
    <textarea id="start-prompt" rows="3" placeholder="What should the agent build?"></textarea>
    <div id="start-actions">
      <button id="start-run">&#9654; Start<span class="kbd">Ctrl+Enter</span></button>
      <button id="start-research" class="start-preset" title="Prefill the Research preset prompt (rates problem variability, picks deep-dives); review or edit it, then Start">&#128269; Research</button>
      <button id="start-readability" class="start-preset" title="Prefill the Readability preset prompt (refactor code to make it easier for humans to read); review or edit it, then Start">&#128200; Readability</button>
      <button id="start-maintainability" class="start-preset" title="Prefill the Maintainability preset prompt (refactor code to make it easier to adapt for future changes); review or edit it, then Start">&#128200; Maintainability</button>
      <span id="start-note"></span>
    </div>
  </section>
  <section id="choice-panel" hidden>
    <h2>Your call</h2>
    <div id="choice-title"></div>
    <div id="choice-file" hidden></div>
    <ul id="choice-options"></ul>
    <div id="choice-actions">
      <button id="choice-accept">Accept<span class="kbd">Ctrl+Enter</span></button>
      <button id="choice-approve" hidden>&#10003; Approve<span class="kbd">Ctrl+Enter</span></button>
      <button id="choice-decline" hidden>&#10007; Decline</button>
      <label id="autopilot-row"><input type="checkbox" id="autopilot-toggle" /> Autopilot</label>
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
<aside id="docs" hidden>
  <div id="docs-nav"></div>
  <div id="docs-body"></div>
</aside>
</div>
<script>
${clientScript(stoppable, choiceable, startable)}
</script>
</body>
</html>`
}

function clientScript(stoppable: boolean, choiceable: boolean, startable: boolean): string {
  // Runs in the browser. Keep it dependency-free.
  return `
const STOPPABLE = ${stoppable ? 'true' : 'false'};
const CHOICEABLE = ${choiceable ? 'true' : 'false'};
const STARTABLE = ${startable ? 'true' : 'false'};
const RESEARCH_PROMPT = ${JSON.stringify(renderResearchPrompt())};
const READABILITY_PROMPT = ${JSON.stringify(renderReadabilityPrompt())};
const MAINTAINABILITY_PROMPT = ${JSON.stringify(renderMaintainabilityPrompt())};
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
    el.innerHTML = '\\u25b6 <a href="' + esc(safeUrl(sessionLink)) + '" target="_blank" rel="noopener">' + label + '</a>' + idTail;
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
    a.href = safeUrl(fe.url); a.textContent = fe.url;
    $('app-banner').hidden = false;
    log('\\u25b6 your app is running at ' + fe.url);
  }
  else if (fe.kind === 'bootstrap') bootstrap(fe.event);
  else if (fe.kind === 'driver') driver(fe.event);
  else if (fe.kind === 'modes') renderModes(fe.all, fe.active);
  else if (fe.kind === 'choice') showChoice(fe);
  else if (fe.kind === 'choice-resolved') resolveChoice(fe);
  else if (fe.kind === 'log') log(fe.message);
  else if (fe.kind === 'usage') updateSpend(fe);
  else if (fe.kind === 'end') {
    if (mode === 'live') { ended = true; $('stop').hidden = true; }
    closeChoice();
    $('status').textContent = fe.ok ? '\\u25cf finished' : fe.stopped ? '\\u25a0 stopped' : '\\u25cf failed';
    notify(
      fe.ok ? '\\u2713 Run finished' : fe.stopped ? '\\u25a0 Run stopped' : '\\u2717 Run failed',
      fe.ok ? 'Your build is ready on the dashboard.' : fe.detail || '');
  }
}
function updateSpend(fe) {
  const el = $('spend');
  let s = 'spend $' + fe.costUsd.toFixed(4);
  if (fe.budgetUsd) s += ' / $' + fe.budgetUsd;
  el.textContent = s;
  el.hidden = false;
}
function stopRun() {
  const btn = $('stop');
  btn.disabled = true;
  btn.textContent = 'stopping\\u2026';
  fetch('stop', { method: 'POST' }).catch(() => {});
}
// Attribute-safe: textContent->innerHTML escapes < > &, but NOT quotes, so we also
// escape " and ' to stay safe inside quoted HTML attributes, not just text nodes.
function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// Neutralize a link before it reaches an href: only http(s)/mailto/relative/anchor
// URLs pass; anything else (javascript:, data:) collapses to '#' so a published
// event can't smuggle a script URL into a clickable link.
function safeUrl(u) { return /^(https?:|mailto:|\\/|#)/i.test(String(u)) ? String(u) : '#'; }

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
  // A confirmation (#358) renders Approve/Decline buttons instead of the option list,
  // pointing at the plan file the doc sidebar shows.
  const confirm = !!req.confirm;
  $('choice-accept').hidden = confirm;
  $('choice-approve').hidden = !confirm;
  $('choice-decline').hidden = !confirm;
  const fileEl = $('choice-file');
  fileEl.hidden = !(confirm && req.file);
  fileEl.textContent = confirm && req.file ? 'Review ' + req.file + ' in the doc panel.' : '';
  // A multi-select (#332) renders checkboxes pre-checked per option default; a
  // single-select renders radios with the recommended option pre-selected (#304).
  const multi = !!req.multi;
  for (const o of (confirm ? [] : (req.options || []))) {
    const li = document.createElement('li');
    const type = multi ? 'checkbox' : 'radio';
    const nameAttr = multi ? '' : ' name="choice-opt"';
    const checked = (multi ? o.default : o.id === req.recommended) ? ' checked' : '';
    li.innerHTML = '<label><input type="' + type + '"' + nameAttr + ' class="choice-opt" value="' + esc(o.id) + '"' + checked + '>' +
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
  // Multi-select: the picked SUBSET (may be empty). Single-select: one id, falling
  // back to the recommended default if somehow nothing is checked.
  if (activeChoice && activeChoice.multi) {
    return [].slice.call(document.querySelectorAll('#choice-options input:checked')).map(function (e) { return e.value; });
  }
  const el = document.querySelector('input[name="choice-opt"]:checked');
  return el ? el.value : (activeChoice ? activeChoice.recommended : null);
}
function renderCount() {
  $('choice-count').textContent = '\\u25cf Auto accept in ' + choiceLeft + 's \\u2014 move the mouse to cancel';
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
  if (choiceTimer) { stopCountdown(); $('choice-count').textContent = 'Auto accept canceled \\u2014 pick manually'; }
}
function acceptChoice(by, pickOverride) {
  if (!activeChoice) return;
  const id = activeChoice.id;
  // The Decline button (#358) posts its pick directly; everything else reads the form
  // (a confirmation has no inputs, so selectedChoice falls back to recommended = approve).
  const pick = pickOverride !== undefined ? pickOverride : selectedChoice();
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
  const picked = Array.isArray(fe.picked) ? (fe.picked.join(', ') || '(none)') : fe.picked;
  log('\\u2713 chose ' + picked + ' (' + fe.by + ')');
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
    const link = r.sessionLink ? ' \\u00b7 <a href="' + esc(safeUrl(r.sessionLink)) + '" target="_blank" rel="noopener">session</a>' : '';
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

// Document sidebar (#319): render the PLAN.md / TODO.md the agent writes at the
// workspace root, with a sticky tab nav to jump between them. Minimal, dependency-
// free markdown so the page stays a single self-contained file.
function mdInline(s) {
  // s is already HTML-escaped; add inline spans and safe (http/relative) links only.
  return s
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
    .replace(/\\[([^\\]]+)\\]\\(([^)\\s"]+)\\)/g, function (m, t, u) {
      return /^(https?:|\\/|#)/.test(u) ? '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>' : t;
    });
}
function renderMarkdown(md) {
  const lines = String(md).replace(/\\r\\n/g, '\\n').split('\\n');
  let html = '', i = 0, inList = false, listTag = '';
  const closeList = function () { if (inList) { html += '</' + listTag + '>'; inList = false; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\`\`\`/.test(line)) {
      closeList(); i++;
      let code = '';
      while (i < lines.length && !/^\`\`\`/.test(lines[i])) { code += lines[i] + '\\n'; i++; }
      i++; // closing fence
      html += '<pre><code>' + esc(code) + '</code></pre>';
      continue;
    }
    const h = line.match(/^(#{1,6})\\s+(.*)$/);
    if (h) { closeList(); const n = h[1].length; html += '<h' + n + '>' + mdInline(esc(h[2])) + '</h' + n + '>'; i++; continue; }
    const li = line.match(/^\\s*[-*]\\s+(.*)$/);
    if (li) {
      if (!inList || listTag !== 'ul') { closeList(); html += '<ul>'; inList = true; listTag = 'ul'; }
      const task = li[1].match(/^\\[([ xX])\\]\\s+(.*)$/);
      if (task) {
        const on = task[1].toLowerCase() === 'x';
        html += '<li class="task"><input type="checkbox" disabled' + (on ? ' checked' : '') + '>' + mdInline(esc(task[2])) + '</li>';
      } else html += '<li>' + mdInline(esc(li[1])) + '</li>';
      i++; continue;
    }
    const oli = line.match(/^\\s*\\d+\\.\\s+(.*)$/);
    if (oli) {
      if (!inList || listTag !== 'ol') { closeList(); html += '<ol>'; inList = true; listTag = 'ol'; }
      html += '<li>' + mdInline(esc(oli[1])) + '</li>';
      i++; continue;
    }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList();
    html += '<p>' + mdInline(esc(line)) + '</p>';
    i++;
  }
  closeList();
  return html;
}
let docs = [];
let activeDoc = null;
function showDoc(name) {
  const doc = docs.find(function (d) { return d.name === name; });
  if (!doc) return;
  activeDoc = name;
  $('docs-body').innerHTML = renderMarkdown(doc.content);
  for (const b of $('docs-nav').children) b.classList.toggle('active', b.dataset && b.dataset.name === name);
}
function renderDocs(list) {
  docs = list || [];
  const aside = $('docs');
  if (!docs.length) { aside.hidden = true; activeDoc = null; $('docs-nav').innerHTML = ''; $('docs-body').innerHTML = ''; return; }
  const nav = $('docs-nav'); nav.innerHTML = '';
  for (const d of docs) {
    const b = document.createElement('button');
    b.className = 'doc-tab'; b.dataset.name = d.name; b.textContent = d.name;
    b.addEventListener('click', function () { showDoc(d.name); });
    nav.appendChild(b);
  }
  aside.hidden = false;
  // Keep the open tab if it still exists, else fall back to the first doc.
  showDoc(docs.some(function (d) { return d.name === activeDoc; }) ? activeDoc : docs[0].name);
}
function loadDocs() {
  fetch('api/docs').then(function (r) { return r.ok ? r.json() : { docs: [] }; })
    .then(function (d) { renderDocs(d.docs || []); }).catch(function () {});
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

// Start a run (#345): POST the prompt to /api/start; the daemon spawns the run
// and its events stream in over the same SSE feed. A 409 means one is active.
// Presets only PREFILL the textarea (#353): a preset button loads its full
// prompt for review/editing and flips startKind to 'prompt' (run the text
// verbatim); nothing is sent until Start / Ctrl+Enter. Clearing the box reverts
// to a normal 'build' run.
let startKind = 'build';
function startNewRun() {
  if (!STARTABLE) return;
  const note = $('start-note');
  const prompt = $('start-prompt').value.trim();
  if (!prompt) { note.textContent = startKind === 'build' ? 'type what to build first' : 'the prompt is empty'; return; }
  const buttons = [$('start-run'), ...document.querySelectorAll('.start-preset')];
  for (const b of buttons) b.disabled = true;
  note.textContent = 'starting\\u2026';
  fetch('api/start', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: prompt, kind: startKind }) })
    .then(async r => {
      for (const b of buttons) b.disabled = false;
      if (r.ok) { note.textContent = ''; $('start-prompt').value = ''; startKind = 'build'; showLive(); return; }
      let msg = 'could not start (' + r.status + ')';
      try { const b = await r.json(); if (b && b.error) msg = b.error; } catch {}
      note.textContent = msg;
    })
    .catch(() => { for (const b of buttons) b.disabled = false; note.textContent = 'could not reach the dashboard server'; });
}
$('start-run').addEventListener('click', startNewRun);
function wirePresetButton(id, name, prompt) {
  $(id).addEventListener('click', () => {
    const box = $('start-prompt');
    box.value = prompt;
    startKind = 'prompt';
    $('start-note').textContent = name + ' preset loaded \\u2014 review or edit, then Start';
    box.focus();
  });
}
wirePresetButton('start-research', 'research', RESEARCH_PROMPT);
wirePresetButton('start-readability', 'readability', READABILITY_PROMPT);
wirePresetButton('start-maintainability', 'maintainability', MAINTAINABILITY_PROMPT);
$('start-prompt').addEventListener('input', () => {
  // An emptied box is a fresh start: back to a normal build run.
  if (!$('start-prompt').value.trim() && startKind !== 'build') { startKind = 'build'; $('start-note').textContent = ''; }
});
$('start-prompt').addEventListener('keydown', ev => {
  // stopPropagation so the document-level Ctrl+Enter never accepts a choice too.
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); startNewRun(); }
});

$('stop').addEventListener('click', stopRun);
$('back-live').addEventListener('click', showLive);
$('choice-accept').addEventListener('click', () => acceptChoice('user'));
$('choice-approve').addEventListener('click', () => acceptChoice('user', 'approve'));
$('choice-decline').addEventListener('click', () => acceptChoice('user', 'decline'));
$('autopilot-toggle').addEventListener('change', ev => {
  localStorage.setItem('framework:autopilot', ev.target.checked ? '1' : '0');
  if (ev.target.checked) startCountdown(); else { stopCountdown(); $('choice-count').textContent = 'Auto accept off'; }
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
  // A plan/backlog is usually written right before a choice gate or at run end;
  // refresh the doc sidebar promptly so PLAN.md / TODO.md appear without waiting.
  if (fe.kind === 'choice' || fe.kind === 'end') setTimeout(loadDocs, 500);
};
src.onerror = () => { if (mode === 'live') $('status').textContent = '\\u25cb offline'; };
loadRuns();
setInterval(loadRuns, 10000);
loadDocs();
setInterval(loadDocs, 4000);
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
