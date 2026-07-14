import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  RunStore,
  applyEventToMeta,
  metaFromEvents,
  listRuns,
  readLiveMeta,
  loadRunEvents,
  RUN_META_VERSION,
  type StoreFs,
  type RunMeta,
} from './run-store.js'
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
    async readdir(dir) {
      // Derive children from the flat path map: basenames whose dirname is `dir`.
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

const AT = '2026-07-04T00:00:00.000Z'
const CWD = '/ws'
const EVENTS = join(CWD, '.the-framework', 'events.jsonl')
const META = join(CWD, '.the-framework', 'run.json')

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

test('applyEventToMeta marks a user-stopped run as stopped, not failed (#218)', () => {
  const base = metaFromEvents(RUN.slice(0, 4), AT)
  const stopped = applyEventToMeta(base, { kind: 'end', ok: false, stopped: true }, AT)
  assert.equal(stopped.status, 'stopped')
})

test('applyEventToMeta records the session name + ready-for-merge lifecycle signals (#326)', () => {
  const base = metaFromEvents(RUN.slice(0, 4), AT)
  assert.equal(base.sessionName, undefined)
  assert.equal(base.readyForMerge, undefined)
  const named = applyEventToMeta(base, { kind: 'session-name', name: 'add-comments' }, AT)
  assert.equal(named.sessionName, 'add-comments')
  const ready = applyEventToMeta(named, { kind: 'ready-for-merge' }, AT)
  assert.equal(ready.readyForMerge, true)
  assert.equal(ready.sessionName, 'add-comments') // ready doesn't clobber the name
})

test('close archives the run into runs/<id>.json + .jsonl for history (#303)', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT })
  for (const event of RUN) await store.append(event)
  await store.close()

  const id = store.snapshot().id
  const archivedMeta = fs.files.get(join(CWD, '.the-framework', 'runs', `${id}.json`))
  const archivedLog = fs.files.get(join(CWD, '.the-framework', 'runs', `${id}.jsonl`))
  assert.ok(archivedMeta, 'meta archived')
  assert.ok(archivedLog, 'log archived')
  assert.equal((JSON.parse(archivedMeta!) as RunMeta).intent, 'a blog with comments')
  assert.equal(archivedLog!.trim().split('\n').length, RUN.length)
})

test('listRuns returns archived runs newest-first with intent + status (#303)', async () => {
  const fs = memFs()
  const a = await RunStore.open(CWD, { fs, fresh: true, now: '2026-07-04T00:00:00.000Z' })
  for (const e of RUN) await a.append(e)
  await a.close()
  const b = await RunStore.open(CWD, { fs, fresh: true, now: '2026-07-05T00:00:00.000Z' })
  await b.append({ kind: 'bootstrap', event: { type: 'scope', scope: 'full', intent: 'a todo app' } })
  await b.close()

  const runs = await listRuns(CWD, fs)
  assert.equal(runs.length, 2)
  assert.equal(runs[0]!.intent, 'a todo app') // newest first
  assert.equal(runs[1]!.intent, 'a blog with comments')
  assert.equal(runs[1]!.status, 'done')
  assert.equal(runs[1]!.sessionLink, 'https://ex.com/s/sess-123')
})

test('readLiveMeta reads the in-progress run.json with a running status (before close)', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT })
  for (const e of RUN.slice(0, -1)) await store.append(e) // every event but the terminal `end`
  // No close(): the run is still live. Its meta reads back as running with the intent.
  const live = await readLiveMeta(CWD, fs)
  assert.ok(live, 'live meta present')
  assert.equal(live!.status, 'running')
  assert.equal(live!.intent, 'a blog with comments')
  assert.equal(live!.id, store.snapshot().id)
})

test('readLiveMeta yields undefined on a never-run workspace', async () => {
  assert.equal(await readLiveMeta(CWD, memFs()), undefined)
})

test('loadRunEvents replays an archived run, and rejects unknown/unsafe ids (#303)', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT })
  for (const e of RUN) await store.append(e)
  await store.close()
  const id = store.snapshot().id

  assert.deepEqual(await loadRunEvents(CWD, id, fs), RUN)
  assert.equal(await loadRunEvents(CWD, 'nope', fs), undefined)
  assert.equal(await loadRunEvents(CWD, '../escape', fs), undefined)
})

test('a fresh run archives a prior run that never got closed (crash safety) (#303)', async () => {
  const fs = memFs()
  const crashed = await RunStore.open(CWD, { fs, fresh: true, now: '2026-07-04T00:00:00.000Z' })
  for (const e of RUN) await crashed.append(e)
  // no close() — simulate a crash. Now a new run opens fresh over the live files.
  await RunStore.open(CWD, { fs, fresh: true, now: '2026-07-05T00:00:00.000Z' })

  const runs = await listRuns(CWD, fs)
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.intent, 'a blog with comments')
})
