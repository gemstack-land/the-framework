import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { RunStore, applyEventToMeta, metaFromEvents, RUN_META_VERSION, type StoreFs, type RunMeta } from './run-store.js'
import type { FrameworkEvent } from '../events.js'

/** An in-memory {@link StoreFs} so the store logic is tested without touching disk. */
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
  }
}

const AT = '2026-07-04T00:00:00.000Z'
const CWD = '/ws'
const EVENTS = join(CWD, '.framework', 'events.jsonl')
const META = join(CWD, '.framework', 'run.json')

const RUN: FrameworkEvent[] = [
  { kind: 'session', driver: 'fake', workspace: CWD, fake: true, sessionLink: 'https://claude.ai/code' },
  { kind: 'bootstrap', event: { type: 'scope', scope: 'full', intent: 'a blog with comments' } },
  { kind: 'session-update', sessionId: 'sess-123', sessionLink: 'https://ex.com/s/sess-123' },
  { kind: 'bootstrap', event: { type: 'checklist', pass: 1, blockers: ['no tests'], passing: false } },
  { kind: 'bootstrap', event: { type: 'checklist', pass: 2, blockers: [], passing: true } },
  { kind: 'end', ok: true },
]

test('fresh open truncates the log and writes an initial meta snapshot', async () => {
  const fs = memFs({ [EVENTS]: 'stale\n' })
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT })
  assert.equal(fs.files.get(EVENTS), '')
  const meta = await store.readMeta()
  assert.equal(meta?.version, RUN_META_VERSION)
  assert.equal(meta?.status, 'running')
  assert.equal(meta?.startedAt, AT)
})

test('append writes one JSONL line per event and derives meta', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT })
  for (const event of RUN) await store.append(event)

  const lines = (fs.files.get(EVENTS) ?? '').trim().split('\n')
  assert.equal(lines.length, RUN.length)
  assert.deepEqual(JSON.parse(lines[0]!), RUN[0])

  const meta = JSON.parse(fs.files.get(META)!) as RunMeta
  assert.equal(meta.intent, 'a blog with comments')
  assert.equal(meta.scope, 'full')
  assert.equal(meta.driver, 'fake')
  assert.equal(meta.workspace, CWD)
  assert.equal(meta.sessionId, 'sess-123')
  assert.equal(meta.sessionLink, 'https://ex.com/s/sess-123')
  assert.equal(meta.passes, 2)
  assert.equal(meta.status, 'done')
})

test('loadEvents round-trips the persisted log', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT })
  for (const event of RUN) await store.append(event)
  const loaded = await store.loadEvents()
  assert.deepEqual(loaded, RUN)
})

test('loadEvents skips a torn trailing line from an interrupted write', async () => {
  const good = RUN.slice(0, 2).map(e => JSON.stringify(e)).join('\n')
  const fs = memFs({ [EVENTS]: good + '\n{"kind":"log","mess' })
  const store = await RunStore.open(CWD, { fs, fresh: false, now: AT })
  const loaded = await store.loadEvents()
  assert.equal(loaded.length, 2)
  assert.equal(loaded[1]!.kind, 'bootstrap')
})

test('a non-fresh open preserves the existing log (resume)', async () => {
  const existing = RUN.map(e => JSON.stringify(e)).join('\n') + '\n'
  const fs = memFs({ [EVENTS]: existing })
  const store = await RunStore.open(CWD, { fs, fresh: false, now: AT })
  assert.equal(fs.files.get(EVENTS), existing)
  assert.equal((await store.loadEvents()).length, RUN.length)
})

test('loadEvents on a never-run workspace yields an empty array', async () => {
  const store = await RunStore.open(CWD, { fs: memFs(), fresh: false, now: AT })
  assert.deepEqual(await store.loadEvents(), [])
})

test('metaFromEvents reconstructs the same snapshot as live appends', async () => {
  const meta = metaFromEvents(RUN, AT)
  assert.equal(meta.intent, 'a blog with comments')
  assert.equal(meta.passes, 2)
  assert.equal(meta.status, 'done')
  assert.equal(meta.startedAt, AT)
})

test('applyEventToMeta marks a thrown run as failed', () => {
  const base = metaFromEvents(RUN.slice(0, 4), AT)
  const failed = applyEventToMeta(base, { kind: 'end', ok: false, detail: 'boom' }, AT)
  assert.equal(failed.status, 'failed')
})
