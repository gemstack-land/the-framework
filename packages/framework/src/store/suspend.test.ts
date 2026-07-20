import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSuspendedRuns, writeSuspendedRuns, resumableRuns, SUSPEND_MAX_AGE_MS, type SuspendedRun } from './suspend.js'
import { FRAMEWORK_DIR } from './run-store.js'

const AT = '2026-07-20T10:00:00.000Z'
const NOW = Date.parse('2026-07-20T12:00:00.000Z')

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'framework-suspend-'))
}

test('a suspended list round-trips, and an absent file reads as nothing to resume (#923)', async () => {
  const cwd = await tmpWorkspace()
  try {
    assert.deepEqual(await readSuspendedRuns(cwd), [])
    const runs: SuspendedRun[] = [
      { runId: '2026-a', sessionId: 'sess-1', suspendedAt: AT },
      { runId: '2026-b', suspendedAt: AT },
    ]
    await writeSuspendedRuns(cwd, runs)
    assert.deepEqual(await readSuspendedRuns(cwd), runs)
    await writeSuspendedRuns(cwd, []) // consumed by a boot
    assert.deepEqual(await readSuspendedRuns(cwd), [])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a malformed suspended file resumes nothing rather than throwing (#923)', async () => {
  const cwd = await tmpWorkspace()
  try {
    await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
    await writeFile(join(cwd, FRAMEWORK_DIR, 'suspended.json'), 'not json')
    assert.deepEqual(await readSuspendedRuns(cwd), [])
    await writeFile(join(cwd, FRAMEWORK_DIR, 'suspended.json'), JSON.stringify([{ nope: true }, { runId: 'ok', suspendedAt: AT }]))
    assert.deepEqual(await readSuspendedRuns(cwd), [{ runId: 'ok', suspendedAt: AT }]) // entries without an id are dropped
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('resumableRuns keeps recent work and drops what has gone stale (#923)', () => {
  const at = (ms: number): string => new Date(NOW - ms).toISOString()
  const runs: SuspendedRun[] = [
    { runId: 'minutes-ago', suspendedAt: at(5 * 60 * 1000) },
    { runId: 'just-inside', suspendedAt: at(SUSPEND_MAX_AGE_MS - 1000) },
    { runId: 'just-outside', suspendedAt: at(SUSPEND_MAX_AGE_MS + 1000) },
    { runId: 'a-week-ago', suspendedAt: at(7 * 24 * 60 * 60 * 1000) },
    { runId: 'unparseable', suspendedAt: 'whenever' },
  ]
  assert.deepEqual(
    resumableRuns(runs, NOW).map(run => run.runId),
    ['minutes-ago', 'just-inside'],
  )
  // A clock that moved backwards leaves a future stamp; that is recent by any reading.
  assert.deepEqual(
    resumableRuns([{ runId: 'future', suspendedAt: new Date(NOW + 60_000).toISOString() }], NOW).map(r => r.runId),
    ['future'],
  )
  assert.deepEqual(resumableRuns([], NOW), [])
})
