import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  appendLog,
  logsPath,
  parseLogs,
  readLogs,
  renderLogEntry,
  LOGS_FILE,
  THE_FRAMEWORK_DIR,
  type LogEntry,
} from './logs.js'
import type { StoreFs } from './store/index.js'

/** An in-memory {@link StoreFs} so the log logic is tested without touching disk. */
function memFs(seed: Record<string, string> = {}): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    async read(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      files.set(path, contents)
    },
    async append(path, contents) {
      files.set(path, (files.get(path) ?? '') + contents)
    },
    async exists(path) {
      return files.has(path)
    },
    async mkdir() {
      // no-op: the memory fs has no directories
    },
    async readdir(dir) {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = new Set<string>()
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) names.add(rest)
      }
      return [...names]
    },
  }
}

const CWD = '/proj'
const LOGS = join(CWD, THE_FRAMEWORK_DIR, LOGS_FILE)

const PROMPT: LogEntry = {
  at: '2026-07-10T09:00:00.000Z',
  kind: 'prompt',
  title: 'Add a login page',
  status: 'done',
  sessionId: 'sess-1',
  sessionLink: 'https://claude.ai/code/sess-1',
}

const LOOP: LogEntry = {
  at: '2026-07-10T10:00:00.000Z',
  kind: 'loop',
  title: 'Polish the dashboard',
  status: 'stopped',
  prompts: ['Fix the header layout', 'Tighten empty states'],
}

const BARE_SESSION: LogEntry = {
  at: '2026-07-10T11:00:00.000Z',
  kind: 'build',
  title: 'A todo app',
  status: 'running',
  sessionId: 'sess-2',
}

const MINIMAL: LogEntry = {
  at: '2026-07-10T12:00:00.000Z',
  kind: 'build',
  title: 'A blog',
  status: 'failed',
}

test('logsPath joins cwd, dir, and file', () => {
  assert.equal(logsPath(CWD), LOGS)
})

test('renderLogEntry renders a prompt with a session link', () => {
  assert.equal(
    renderLogEntry(PROMPT),
    [
      '## 2026-07-10T09:00:00.000Z · prompt · Add a login page',
      '',
      '- status: done',
      '- session: [sess-1](https://claude.ai/code/sess-1)',
    ].join('\n'),
  )
})

test('renderLogEntry renders a loop with its prompts', () => {
  assert.equal(
    renderLogEntry(LOOP),
    [
      '## 2026-07-10T10:00:00.000Z · loop · Polish the dashboard',
      '',
      '- status: stopped',
      '- prompts:',
      '  - Fix the header layout',
      '  - Tighten empty states',
    ].join('\n'),
  )
})

test('renderLogEntry renders a bare session id when there is no link', () => {
  assert.equal(
    renderLogEntry(BARE_SESSION),
    ['## 2026-07-10T11:00:00.000Z · build · A todo app', '', '- status: running', '- session: sess-2'].join('\n'),
  )
})

test('renderLogEntry omits session and prompts lines when absent', () => {
  assert.equal(
    renderLogEntry(MINIMAL),
    ['## 2026-07-10T12:00:00.000Z · build · A blog', '', '- status: failed'].join('\n'),
  )
})

test('parseLogs(renderLogEntry(e)) round-trips every entry shape', () => {
  for (const entry of [PROMPT, LOOP, BARE_SESSION, MINIMAL]) {
    assert.deepEqual(parseLogs(renderLogEntry(entry)), [entry])
  }
})

test('a title containing the separator round-trips intact', () => {
  const entry: LogEntry = { ...MINIMAL, title: 'A blog · with comments · and tags' }
  assert.deepEqual(parseLogs(renderLogEntry(entry)), [entry])
})

test('a multi-line title stays on one line and round-trips (#897)', () => {
  const entry: LogEntry = { ...MINIMAL, title: 'Add a blog\n\n- with comments\n- and tags' }
  const md = renderLogEntry(entry)
  assert.equal(md.split('\n')[0], '## 2026-07-10T12:00:00.000Z · build · Add a blog\\n\\n- with comments\\n- and tags')
  assert.deepEqual(parseLogs(md), [entry])
})

test('a title cannot forge an entry or rewrite the status (#897)', () => {
  const title = 'Ship it\n## 2026-01-01T00:00:00.000Z · build · Forged\n\n- status: done'
  const parsed = parseLogs(renderLogEntry({ ...MINIMAL, title }))
  assert.deepEqual(parsed, [{ ...MINIMAL, title }])
  assert.equal(parsed[0]!.status, 'failed')
})

test('a backslash in a title survives the escaping (#897)', () => {
  const entry: LogEntry = { ...MINIMAL, title: 'Escape \\n and \\\\ literally' }
  assert.deepEqual(parseLogs(renderLogEntry(entry)), [entry])
})

test('a multi-line prompt bullet stays on one line and round-trips (#897)', () => {
  const entry: LogEntry = { ...LOOP, prompts: ['Fix the header\n- and the footer'] }
  const lines = renderLogEntry(entry).split('\n')
  assert.equal(lines.at(-1), '  - Fix the header\\n- and the footer')
  assert.deepEqual(parseLogs(renderLogEntry(entry)), [entry])
})

test('an entry written before #897 still parses', () => {
  const md = ['## 2026-07-10T12:00:00.000Z · build · A blog', '', '- status: failed'].join('\n')
  assert.deepEqual(parseLogs(md), [MINIMAL])
})

test('parseLogs on empty input is []', () => {
  assert.deepEqual(parseLogs(''), [])
})

test('parseLogs skips malformed entries but keeps the good ones around them', () => {
  const md = [
    '# The Framework logs',
    '',
    renderLogEntry(PROMPT),
    '',
    '## 2026-07-10T10:30:00.000Z · deploy · Not a real kind',
    '',
    '- status: done',
    '',
    '## 2026-07-10T10:45:00.000Z · build · Missing its status',
    '',
    renderLogEntry(LOOP),
  ].join('\n')
  assert.deepEqual(parseLogs(md), [PROMPT, LOOP])
})

test('appendLog writes the header once and readLogs returns entries newest-first', async () => {
  const fs = memFs()
  await appendLog(CWD, PROMPT, fs)
  await appendLog(CWD, LOOP, fs)

  const raw = fs.files.get(LOGS)!
  assert.ok(raw.startsWith('# The Framework logs\n'))
  assert.equal(raw.split('# The Framework logs').length, 2) // header written exactly once
  assert.equal(parseLogs(raw).length, 2)

  assert.deepEqual(await readLogs(CWD, fs), [LOOP, PROMPT])
})

test('readLogs on a missing file is []', async () => {
  assert.deepEqual(await readLogs(CWD, memFs()), [])
})

test('appendLog creates the .the-framework dir and only writes the header when absent', async () => {
  const fs = memFs()
  const dirs: string[] = []
  const spied: StoreFs = { ...fs, mkdir: async path => void dirs.push(path) }
  await appendLog(CWD, PROMPT, spied)
  assert.deepEqual(dirs, [join(CWD, THE_FRAMEWORK_DIR)])

  const afterFirst = fs.files.get(LOGS)!
  await appendLog(CWD, LOOP, spied)
  const afterSecond = fs.files.get(LOGS)!
  assert.ok(afterSecond.startsWith(afterFirst)) // second append did not rewrite the header
  assert.equal(afterSecond.split('# The Framework logs').length, 2)
})
