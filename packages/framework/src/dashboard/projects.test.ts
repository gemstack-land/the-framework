import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { summarizeProject, singleProjectProvider, type SummarizeDeps } from './projects.js'
import type { ProjectRecord } from '../registry.js'
import type { LogEntry } from '../logs.js'
import { RUN_META_VERSION, type RunMeta } from '../store/index.js'

const RECORD: ProjectRecord = { id: 'app-a-1', path: '/repos/app-a', addedAt: '2026-07-11T00:00:00.000Z' }

function deps(over: SummarizeDeps): SummarizeDeps {
  return {
    isActivated: async () => true,
    readLogs: async () => [],
    readRuns: async () => [],
    readFileConfig: async () => ({}),
    ...over,
  }
}

const run = (id: string, updatedAt: string): RunMeta => ({
  version: RUN_META_VERSION,
  status: 'stopped',
  id,
  startedAt: updatedAt,
  updatedAt,
  passes: 0,
})

test('summarizeProject derives name from the path basename', async () => {
  const summary = await summarizeProject(RECORD, deps({}))
  assert.equal(summary.name, 'app-a')
  assert.equal(summary.id, 'app-a-1')
  assert.equal(summary.path, '/repos/app-a')
})

test('lastActivityAt is the newest LOGS.md entry (readLogs is newest-first)', async () => {
  const logs: LogEntry[] = [
    { at: '2026-07-11T10:00:00.000Z', kind: 'build', title: 'newest', status: 'done' },
    { at: '2026-07-10T09:00:00.000Z', kind: 'prompt', title: 'older', status: 'done' },
  ]
  const summary = await summarizeProject(RECORD, deps({ readLogs: async () => logs }))
  assert.equal(summary.lastActivityAt, '2026-07-11T10:00:00.000Z')
})

test('no log entries means no lastActivityAt key at all', async () => {
  const summary = await summarizeProject(RECORD, deps({ readLogs: async () => [] }))
  assert.equal('lastActivityAt' in summary, false)
})

test('lastActivityAt falls back to the newest run when there are no LOGS.md entries (#645)', async () => {
  const summary = await summarizeProject(
    RECORD,
    deps({ readRuns: async () => [run('b', '2026-07-12T00:00:00.000Z'), run('a', '2026-07-10T00:00:00.000Z')] }),
  )
  assert.equal(summary.lastActivityAt, '2026-07-12T00:00:00.000Z')
})

test('lastActivityAt is the newest of LOGS.md and runs, either way (#645)', async () => {
  const newerRun = deps({
    readLogs: async () => [{ at: '2026-07-11T00:00:00.000Z', kind: 'build', title: 'log', status: 'done' }],
    readRuns: async () => [run('x', '2026-07-14T00:00:00.000Z')],
  })
  assert.equal((await summarizeProject(RECORD, newerRun)).lastActivityAt, '2026-07-14T00:00:00.000Z')

  const newerLog = deps({
    readLogs: async () => [{ at: '2026-07-20T00:00:00.000Z', kind: 'build', title: 'log', status: 'done' }],
    readRuns: async () => [run('x', '2026-07-14T00:00:00.000Z')],
  })
  assert.equal((await summarizeProject(RECORD, newerLog)).lastActivityAt, '2026-07-20T00:00:00.000Z')
})

test('activation reflects the injected check', async () => {
  const summary = await summarizeProject(RECORD, deps({ isActivated: async () => false }))
  assert.equal(summary.activated, false)
})

test('a throwing reader is forgiving: inactive, no activity, never throws', async () => {
  const summary = await summarizeProject(
    RECORD,
    deps({
      isActivated: async () => {
        throw new Error('stat failed')
      },
      readLogs: async () => {
        throw new Error('read failed')
      },
    }),
  )
  assert.equal(summary.activated, false)
  assert.equal('lastActivityAt' in summary, false)
})

test('singleProjectProvider (#427) lists exactly the one cwd under the fixed id', async () => {
  const provider = singleProjectProvider('/repos/scratch')
  const list = await provider.list()
  assert.equal(list.length, 1)
  assert.equal(list[0]?.id, 'home')
  assert.equal(list[0]?.path, '/repos/scratch')
  assert.equal(list[0]?.name, 'scratch')
})

test('singleProjectProvider resolves the fixed id to cwd and everything else to nothing', async () => {
  const provider = singleProjectProvider('/repos/scratch')
  assert.equal(await provider.resolvePath('home'), '/repos/scratch')
  assert.equal(await provider.resolvePath('anything-else'), undefined)
})

test('singleProjectProvider honors a custom id', async () => {
  const provider = singleProjectProvider('/repos/scratch', 'run-1')
  assert.equal((await provider.list())[0]?.id, 'run-1')
  assert.equal(await provider.resolvePath('run-1'), '/repos/scratch')
  assert.equal(await provider.resolvePath('home'), undefined)
})

test('the summary carries the repo the-framework.yml so the launcher can resolve (#842)', async () => {
  const summary = await summarizeProject(
    RECORD,
    deps({ readFileConfig: async () => ({ preset: 'software-development', autopilot: true }) }),
  )
  assert.deepEqual(summary.fileConfig, { preset: 'software-development', autopilot: true })
})

test('a repo that sets nothing carries no fileConfig key at all (#842)', async () => {
  const summary = await summarizeProject(RECORD, deps({ readFileConfig: async () => ({}) }))
  assert.equal('fileConfig' in summary, false)
})

test('an unreadable yml leaves the summary intact (#842)', async () => {
  // loadFrameworkConfig already downgrades a malformed file to {}; this covers the read itself
  // failing, which must not take the whole project summary down with it.
  const summary = await summarizeProject(
    RECORD,
    deps({
      readFileConfig: async () => {
        throw new Error('EACCES')
      },
    }),
  )
  assert.equal(summary.name, 'app-a')
  assert.equal(summary.fileConfig, undefined)
})
