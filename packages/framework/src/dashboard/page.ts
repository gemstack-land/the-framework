/**
 * The single self-contained dashboard page: HTML + inline CSS + inline JS, no
 * assets, no build step. The client opens an `EventSource` to `/events` and
 * projects the {@link import('../events.js').FrameworkEvent} stream into panels
 * that foreground the orchestration (stack rationale, loop status, decisions)
 * beside a tail of the wrapped agent's own activity.
 */
export function dashboardHtml(title: string): string {
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
  #app-banner { display: flex; align-items: center; gap: 8px; padding: 10px 20px;
    background: #0f2417; border-bottom: 1px solid #1c3a28; font-size: 13px; }
  #app-banner .dot { color: #67d98f; }
  #app-banner a { color: #67d98f; font-weight: 600; }
  #app-banner .run { color: #6f8a79; font-size: 12px; }
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
</header>
<div id="app-banner" hidden>
  <span class="dot">▶</span>
  <span>Your app is running at <a id="app-link" href="#" target="_blank" rel="noopener">…</a></span>
  <span class="run">live until you stop the run</span>
</div>
<main>
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
<script>
${clientScript()}
</script>
</body>
</html>`
}

function clientScript(): string {
  // Runs in the browser. Keep it dependency-free.
  return `
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
function setSessionLink(sessionId, sessionLink) {
  const el = $('session-link');
  if (sessionLink) {
    el.innerHTML = '\\u25b6 <a href="' + esc(sessionLink) + '" target="_blank" rel="noopener">live session</a>';
    if (sessionId) el.title = sessionId;
  } else if (sessionId) {
    el.innerHTML = 'session <code>' + esc(sessionId) + '</code>';
  }
}
function onEvent(fe) {
  if (fe.kind === 'session') {
    let s = fe.fake ? 'fake driver' : fe.driver;
    s += '  in  ' + fe.workspace;
    $('session').textContent = s;
    if (fe.sessionLink) setSessionLink(undefined, fe.sessionLink);
  } else if (fe.kind === 'session-update') setSessionLink(fe.sessionId, fe.sessionLink);
  else if (fe.kind === 'preview') {
    const a = $('app-link');
    a.href = fe.url; a.textContent = fe.url;
    $('app-banner').hidden = false;
    log('\\u25b6 your app is running at ' + fe.url);
  }
  else if (fe.kind === 'bootstrap') bootstrap(fe.event);
  else if (fe.kind === 'driver') driver(fe.event);
  else if (fe.kind === 'log') log(fe.message);
  else if (fe.kind === 'end') { $('status').textContent = fe.ok ? '\\u25cf finished' : '\\u25cf failed'; }
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
const src = new EventSource('/events');
src.onmessage = ev => { try { onEvent(JSON.parse(ev.data)); } catch {} };
src.onerror = () => { $('status').textContent = '\\u25cb offline'; };
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
