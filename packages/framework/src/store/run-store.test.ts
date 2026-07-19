import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { hostname } from 'node:os'
import {
  RunStore,
  applyEventToMeta,
  metaFromEvents,
  listRuns,
  readLiveMeta,
  reconcileOrphanedRuns,
  loadRunEvents,
  runIdFromStartedAt,
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

test('fresh open seeds the run intent into the snapshot (so prompt runs are not "(no prompt)")', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT, intent: 'what is your name' })
  assert.equal((await store.readMeta())?.intent, 'what is your name')
})

test('a scope event still refines a seeded intent (build path)', async () => {
  const fs = memFs()
  const store = await RunStore.open(CWD, { fs, fresh: true, now: AT, intent: 'build a blog' })
  await store.append({ kind: 'bootstrap', event: { type: 'scope', scope: 'full', intent: 'a blog with comments' } })
  assert.equal(store.snapshot().intent, 'a blog with comments')
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

test('applyEventToMeta tracks the pending choice gate a run is parked on (#636)', () => {
  const base = metaFromEvents(RUN.slice(0, 4), AT)
  assert.equal(base.pendingChoice, undefined)
  const asked = applyEventToMeta(base, { kind: 'choice', id: 'g1', title: 'Cache the auth store?', options: [{ id: 'y', label: 'Yes' }] }, AT)
  assert.deepEqual(asked.pendingChoice, { id: 'g1', title: 'Cache the auth store?' })
  // A resolve for a different gate id leaves it parked; the matching resolve clears it.
  const other = applyEventToMeta(asked, { kind: 'choice-resolved', id: 'other', picked: 'y', by: 'user' }, AT)
  assert.deepEqual(other.pendingChoice, { id: 'g1', title: 'Cache the auth store?' })
  const resolved = applyEventToMeta(asked, { kind: 'choice-resolved', id: 'g1', picked: 'y', by: 'user' }, AT)
  assert.equal(resolved.pendingChoice, undefined)
})

test('applyEventToMeta clears a pending choice when the run ends (#636)', () => {
  const base = metaFromEvents(RUN.slice(0, 4), AT)
  const asked = applyEventToMeta(base, { kind: 'choice', id: 'g1', title: 'q?', options: [{ id: 'y', label: 'Yes' }] }, AT)
  const ended = applyEventToMeta(asked, { kind: 'end', ok: true }, AT)
  assert.equal(ended.pendingChoice, undefined)
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

const RUNS = join(CWD, '.the-framework', 'runs')
const runningMeta = (id: string): string =>
  JSON.stringify({ version: RUN_META_VERSION, status: 'running', id, startedAt: AT, updatedAt: AT, passes: 0 })

test('reconcileOrphanedRuns flips archived runs stuck at running to stopped (#642)', async () => {
  const fs = memFs({
    [join(RUNS, 'a.json')]: runningMeta('a'),
    [join(RUNS, 'b.json')]: runningMeta('b'),
    [join(RUNS, 'c.json')]: JSON.stringify({ version: RUN_META_VERSION, status: 'done', id: 'c', startedAt: AT, updatedAt: AT, passes: 0 }),
  })
  const fixed = await reconcileOrphanedRuns(CWD, fs)
  assert.equal(fixed, 2)
  const runs = await listRuns(CWD, fs)
  assert.deepEqual(runs.map(r => [r.id, r.status]).sort(), [['a', 'stopped'], ['b', 'stopped'], ['c', 'done']])
})

test('reconcileOrphanedRuns flips a live run and archives it, counting it once (#642)', async () => {
  const fs = memFs({ [META]: runningMeta('2026-live') })
  const fixed = await reconcileOrphanedRuns(CWD, fs)
  assert.equal(fixed, 1)
  // The live run.json is now stopped...
  assert.equal((await readLiveMeta(CWD, fs))!.status, 'stopped')
  // ...and archived (as stopped) so it stays in the history list.
  const runs = await listRuns(CWD, fs)
  assert.deepEqual(runs.map(r => [r.id, r.status]), [['2026-live', 'stopped']])
})

test('reconcileOrphanedRuns is a no-op on a clean or empty workspace (#642)', async () => {
  assert.equal(await reconcileOrphanedRuns(CWD, memFs()), 0)
  const done = memFs({ [META]: JSON.stringify({ version: RUN_META_VERSION, status: 'done', id: 'd', startedAt: AT, updatedAt: AT, passes: 0 }) })
  assert.equal(await reconcileOrphanedRuns(CWD, done), 0)
})

// #716: a run whose process dies without writing `end`. The owning pid+host are persisted so a
// reader can flip it to `stopped` (and archive it) without waiting for a daemon-restart reconcile.
const HERE = hostname()
const ownedMeta = (id: string, pid: number, host: string): string =>
  JSON.stringify({ version: RUN_META_VERSION, status: 'running', id, startedAt: AT, updatedAt: AT, passes: 0, pid, host })

test('a fresh open records the owning pid + host so a dead run can be detected (#716)', async () => {
  const fs = memFs()
  await RunStore.open(CWD, { fs, fresh: true, now: AT, owner: { pid: 4242, host: 'box-a' } })
  const meta = JSON.parse(fs.files.get(META)!) as RunMeta
  assert.equal(meta.pid, 4242)
  assert.equal(meta.host, 'box-a')
})

test('readLiveMeta self-heals a running run whose owning process is gone: stopped + archived (#716)', async () => {
  const fs = memFs({ [META]: ownedMeta('2026-dead', 999999, HERE) })
  const live = await readLiveMeta(CWD, fs, () => false) // pid probe says the owner is gone
  assert.equal(live!.status, 'stopped')
  // The on-disk run.json is flipped, and the run is archived (as stopped) so it stays in history.
  assert.equal((JSON.parse(fs.files.get(META)!) as RunMeta).status, 'stopped')
  const runs = await listRuns(CWD, fs)
  assert.deepEqual(runs.map(r => [r.id, r.status]), [['2026-dead', 'stopped']])
})

test('readLiveMeta leaves a running run alone while its owning process is alive (#716)', async () => {
  const fs = memFs({ [META]: ownedMeta('2026-live', process.pid, HERE) })
  const live = await readLiveMeta(CWD, fs, () => true)
  assert.equal(live!.status, 'running')
  assert.equal((JSON.parse(fs.files.get(META)!) as RunMeta).status, 'running')
})

test('readLiveMeta leaves a pre-pid run untouched — the boot reconcile still catches it (#716)', async () => {
  const fs = memFs({ [META]: runningMeta('2026-old') }) // no pid recorded
  const live = await readLiveMeta(CWD, fs, () => false)
  assert.equal(live!.status, 'running')
})

test('readLiveMeta does not trust a pid from a different host (#716)', async () => {
  const fs = memFs({ [META]: ownedMeta('2026-remote', 4242, 'other-box') })
  const live = await readLiveMeta(CWD, fs, () => false)
  assert.equal(live!.status, 'running') // a dead-looking pid on another host is unknowable here
})

test('fresh open adopts the id the daemon allocated, ignoring an unsafe one (#736)', async () => {
  // The daemon names the run's worktree with the id before spawning it, so the run must
  // record that id rather than derive a second one from its own start time.
  const adopted = await RunStore.open(CWD, { fs: memFs(), fresh: true, now: AT, id: 'run-42' })
  assert.equal((await adopted.readMeta())?.id, 'run-42')

  // A traversal-shaped id is dropped for the derived one: the id names a directory.
  const unsafe = await RunStore.open(CWD, { fs: memFs(), fresh: true, now: AT, id: '../evil' })
  assert.equal((await unsafe.readMeta())?.id, runIdFromStartedAt(AT))
})
