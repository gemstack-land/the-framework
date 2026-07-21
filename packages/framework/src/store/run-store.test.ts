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
  readLiveMetas,
  archiveWorktreeRun,
  restoreArchivedRun,
  listWorktreeDirs,
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
      // Derive children from the flat path map: file basenames whose dirname is `dir`, plus
      // the first segment of anything deeper (the real fs lists subdirectories too, which is
      // how `readLiveMetas` finds the per-run worktrees).
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = new Set<string>()
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        const head = rest.split('/')[0]
        if (head) names.add(head)
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

test('applyEventToMeta tracks whether the run is working or parked on the user (#785)', () => {
  const base = metaFromEvents(RUN.slice(0, 4), AT)
  assert.equal(base.settledAt, undefined, 'a working run is not parked')

  const parked = applyEventToMeta(base, { kind: 'settled' }, AT)
  assert.equal(parked.settledAt, AT)
  assert.equal(parked.status, 'running', 'still live: it holds the project and takes messages')

  // The user answers: the next turn starts, so it is working again.
  const working = applyEventToMeta(parked, { kind: 'driver', event: { type: 'start', prompt: 'and dark mode' } }, AT)
  assert.equal(working.settledAt, undefined)

  // A run that has ended is not waiting on anyone.
  const ended = applyEventToMeta(applyEventToMeta(base, { kind: 'settled' }, AT), { kind: 'end', ok: true }, AT)
  assert.equal(ended.settledAt, undefined)
  assert.equal(ended.status, 'done')
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

// #926: it used to flip every `running` meta, on the assumption that a fresh daemon drives no
// in-flight run. A second daemon boot then marked genuinely live runs as finished.
test('reconcileOrphanedRuns leaves a run whose pid is alive on this host (#926)', async () => {
  const owned = (id: string, over: Record<string, unknown> = {}): string =>
    JSON.stringify({ version: RUN_META_VERSION, status: 'running', id, startedAt: AT, updatedAt: AT, passes: 0, pid: 42, host: hostname(), ...over })
  const fs = memFs({
    [META]: owned('live'),
    [join(RUNS, 'alive.json')]: owned('alive'),
    [join(RUNS, 'dead.json')]: owned('dead', { pid: 43 }),
    [join(RUNS, 'elsewhere.json')]: owned('elsewhere', { host: 'another-machine' }),
    ...worktreeFiles('wt', JSON.parse(owned('wt')) as Record<string, unknown>),
  })
  // Only pid 42 is running; 43 is gone, and a pid on another host is unknowable so it is flipped.
  const fixed = await reconcileOrphanedRuns(CWD, fs, pid => pid === 42)
  assert.equal(fixed, 2, 'only the two that are not provably alive')
  // Read the files, not `readLiveMeta`/`listRuns`: those run their own #716 probe against the
  // real process table, and pid 42 is not alive here.
  const statusOf = (path: string): string => (JSON.parse(fs.files.get(path)!) as RunMeta).status
  assert.equal(statusOf(META), 'running', 'the live run is still running')
  assert.equal(statusOf(join(worktreeAt('wt'), '.the-framework', 'run.json')), 'running', 'and so is the one in a worktree')
  assert.equal(statusOf(join(RUNS, 'alive.json')), 'running')
  assert.equal(statusOf(join(RUNS, 'dead.json')), 'stopped')
  assert.equal(statusOf(join(RUNS, 'elsewhere.json')), 'stopped', 'a pid on another host is unknowable, so it is still flipped')
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

// #738: since #736 a run lives in its own worktree, so a project's live runs are spread across
// `.the-framework/worktrees/*` rather than sitting at the project path.
const worktreeMeta = (runId: string, over: Partial<RunMeta> = {}): string =>
  JSON.stringify({ version: 1, status: 'running', id: runId, startedAt: AT, updatedAt: AT, passes: 0, ...over })

test('readLiveMetas finds a run living in each worktree, newest first (#738)', async () => {
  const fs = memFs({
    [join(CWD, '.the-framework', 'worktrees', 'r1', '.the-framework', 'run.json')]: worktreeMeta('r1'),
    [join(CWD, '.the-framework', 'worktrees', 'r2', '.the-framework', 'run.json')]: worktreeMeta('r2'),
  })
  const runs = await readLiveMetas(CWD, fs)
  assert.deepEqual(
    runs.map(r => ({ id: r.id, cwd: r.cwd })),
    [
      { id: 'r2', cwd: join(CWD, '.the-framework', 'worktrees', 'r2') },
      { id: 'r1', cwd: join(CWD, '.the-framework', 'worktrees', 'r1') },
    ],
    'both runs, newest id first, each carrying its own checkout',
  )
})

test('readLiveMetas also returns a run at the project root (the non-git fallback, and pre-#736 runs)', async () => {
  const fs = memFs({
    [META]: worktreeMeta('root-run'),
    [join(CWD, '.the-framework', 'worktrees', 'r1', '.the-framework', 'run.json')]: worktreeMeta('r1'),
  })
  const runs = await readLiveMetas(CWD, fs)
  assert.deepEqual(runs.map(r => r.id).sort(), ['r1', 'root-run'])
  assert.equal(runs.find(r => r.id === 'root-run')?.cwd, CWD, 'the root run reports the repo itself')
})

test('readLiveMetas is empty on a project that never ran, and skips a junk worktree name', async () => {
  assert.deepEqual(await readLiveMetas(CWD, memFs()), [])
  // Only our own `<runId>` directories are read; anything else in there is not a run of ours.
  const fs = memFs({
    [join(CWD, '.the-framework', 'worktrees', '.tmp-scratch', '.the-framework', 'run.json')]: worktreeMeta('x'),
  })
  assert.deepEqual(await readLiveMetas(CWD, fs), [])
})

test('readLiveMetas self-heals a dead run in a worktree, same as the single reader (#716)', async () => {
  const path = join(CWD, '.the-framework', 'worktrees', 'r1', '.the-framework', 'run.json')
  const fs = memFs({ [path]: worktreeMeta('r1', { pid: 999999, host: hostname() }) })
  const runs = await readLiveMetas(CWD, fs, () => false)
  assert.equal(runs[0]?.status, 'stopped', 'a running meta whose process is gone reads as stopped')
  assert.equal((JSON.parse(fs.files.get(path)!) as RunMeta).status, 'stopped', 'and is healed on disk')
})

// #737: a run's history lives inside its worktree, so removing that worktree would delete the run
// from the dashboard's history. It is copied into the repo first, which is what makes teardown safe.
const worktreeAt = (runId: string) => join(CWD, '.the-framework', 'worktrees', runId)
const worktreeFiles = (runId: string, meta: Record<string, unknown>, events = '') => ({
  [join(worktreeAt(runId), '.the-framework', 'run.json')]: JSON.stringify(meta),
  [join(worktreeAt(runId), '.the-framework', 'events.jsonl')]: events,
})

test('archiveWorktreeRun copies a finished run into the repo history (#737)', async () => {
  const fs = memFs(worktreeFiles('r1', { version: 1, status: 'done', id: 'r1', startedAt: AT, updatedAt: AT, passes: 2 }, '{"kind":"log","message":"hi"}\n'))
  const meta = await archiveWorktreeRun(worktreeAt('r1'), CWD, fs)
  assert.equal(meta?.status, 'done')
  assert.equal(fs.files.get(join(CWD, '.the-framework', 'runs', 'r1.jsonl')), '{"kind":"log","message":"hi"}\n', 'the log lands in the repo')
  assert.equal((JSON.parse(fs.files.get(join(CWD, '.the-framework', 'runs', 'r1.json'))!) as RunMeta).passes, 2)
  // And the archived copy is what listRuns reads, so the run survives losing its worktree.
  assert.deepEqual((await listRuns(CWD, fs)).map(r => r.id), ['r1'])
})

test('archiveWorktreeRun records a run that died mid-flight as stopped, not running (#737)', async () => {
  const fs = memFs(worktreeFiles('r1', { version: 1, status: 'running', id: 'r1', startedAt: AT, updatedAt: AT, passes: 0 }))
  // The process is gone by the time we archive, so `running` here means it never closed.
  assert.equal((await archiveWorktreeRun(worktreeAt('r1'), CWD, fs))?.status, 'stopped')
  assert.equal((JSON.parse(fs.files.get(join(CWD, '.the-framework', 'runs', 'r1.json'))!) as RunMeta).status, 'stopped')
})

test('archiveWorktreeRun is forgiving of a worktree with no run', async () => {
  assert.equal(await archiveWorktreeRun(worktreeAt('nope'), CWD, memFs()), undefined)
})

test('reconcileOrphanedRuns rescues a run a crashed daemon left in a worktree (#737)', async () => {
  const fs = memFs(worktreeFiles('r1', { version: 1, status: 'running', id: 'r1', startedAt: AT, updatedAt: AT, passes: 0 }))
  assert.equal(await reconcileOrphanedRuns(CWD, fs), 1)
  assert.equal(
    (JSON.parse(fs.files.get(join(worktreeAt('r1'), '.the-framework', 'run.json'))!) as RunMeta).status,
    'stopped',
    'the live meta stops claiming to be running',
  )
  assert.equal(
    (JSON.parse(fs.files.get(join(CWD, '.the-framework', 'runs', 'r1.json'))!) as RunMeta).status,
    'stopped',
    'and its history is rescued into the repo',
  )
})

test('listWorktreeDirs names the run of each worktree, ignoring anything else in there', async () => {
  const fs = memFs({
    ...worktreeFiles('r1', { id: 'r1' }),
    ...worktreeFiles('r2', { id: 'r2' }),
    [join(CWD, '.the-framework', 'worktrees', '.tmp', 'x')]: '',
  })
  assert.deepEqual((await listWorktreeDirs(CWD, fs)).sort(), ['r1', 'r2'])
  assert.deepEqual(await listWorktreeDirs(join(CWD, 'never-ran'), fs), [])
})

// #762: messaging a stopped run continues THAT run, so the history shows one row rather than an
// unrelated-looking second one. The follow-up is still a separate process; what makes it one run is
// that it reopens the same log instead of truncating it.
test('continueRun reopens the existing run: same id, same log, running again (#762)', async () => {
  const fs = memFs({
    [META]: JSON.stringify({ version: 1, status: 'stopped', id: 'r1', startedAt: AT, updatedAt: AT, passes: 3, intent: 'build a blog' }),
    [EVENTS]: '{"kind":"log","message":"first leg"}\n',
  })
  const store = await RunStore.open(CWD, { fs, continueRun: true, now: '2026-07-04T01:00:00.000Z' })
  const meta = await store.readMeta()
  assert.equal(meta?.id, 'r1', 'the same run, so the rail shows one row')
  assert.equal(meta?.status, 'running', 'live again')
  assert.equal(meta?.intent, 'build a blog', 'and keeps what it was originally asked to do')
  assert.equal(meta?.passes, 3, 'and what it already did')
  assert.equal(fs.files.get(EVENTS), '{"kind":"log","message":"first leg"}\n', 'the earlier output survives')

  // The continuing process owns it now, so a liveness probe reads it as alive, not orphaned (#716).
  assert.equal(meta?.pid, process.pid)

  await store.append({ kind: 'log', message: 'second leg' })
  assert.match(fs.files.get(EVENTS)!, /first leg[\s\S]*second leg/, 'the second leg appends to the same log')
})

test('continueRun with nothing to reopen falls back to a fresh run (#762)', async () => {
  const store = await RunStore.open(CWD, { fs: memFs(), continueRun: true, fresh: true, now: AT, id: 'r9' })
  assert.equal((await store.readMeta())?.id, 'r9')
  assert.equal((await store.readMeta())?.status, 'running')
})

test('restoreArchivedRun puts a torn-down run history back in its worktree (#762)', async () => {
  // #737 moved the history to the repo and removed the checkout; continuing needs it back.
  const fs = memFs({
    [join(CWD, '.the-framework', 'runs', 'r1.json')]: JSON.stringify({ version: 1, status: 'done', id: 'r1', startedAt: AT, updatedAt: AT, passes: 1 }),
    [join(CWD, '.the-framework', 'runs', 'r1.jsonl')]: '{"kind":"log","message":"archived"}\n',
  })
  const wt = join(CWD, '.the-framework', 'worktrees', 'r1')
  assert.equal(await restoreArchivedRun(CWD, wt, 'r1', fs), true)
  assert.equal(fs.files.get(join(wt, '.the-framework', 'events.jsonl')), '{"kind":"log","message":"archived"}\n')
  assert.equal((JSON.parse(fs.files.get(join(wt, '.the-framework', 'run.json'))!) as RunMeta).id, 'r1')

  // Idempotent: a checkout that already holds a live run keeps it (its log is the newer one).
  assert.equal(await restoreArchivedRun(CWD, wt, 'r1', fs), false)
  // Nothing archived, nothing to do.
  assert.equal(await restoreArchivedRun(CWD, join(CWD, 'nope'), 'r404', memFs()), false)
})

test('updatedAt tracks the last event, not the run start (settledAt likewise)', async () => {
  // The regression: the open timestamp was reused for every append, so a run that had been going
  // for hours still reported updatedAt === startedAt. Everything that orders by recency — the
  // overview's active runs, the activity feed, the interventions queue — sorted on that.
  const ticks = ['2026-01-01T00:00:10.000Z', '2026-01-01T00:00:20.000Z']
  let tick = 0
  const store = await RunStore.open('/w', {
    fs: memFs(),
    fresh: true,
    now: AT,
    clock: () => ticks[Math.min(tick++, ticks.length - 1)]!,
  })

  assert.equal(store.snapshot().startedAt, AT)
  assert.equal(store.snapshot().updatedAt, AT, 'nothing appended yet')

  await store.append({ kind: 'log', message: 'first' })
  assert.equal(store.snapshot().updatedAt, ticks[0])

  await store.append({ kind: 'log', message: 'second' })
  assert.equal(store.snapshot().updatedAt, ticks[1], 'each event advances it')
  assert.equal(store.snapshot().startedAt, AT, 'the start is still the start')
})
