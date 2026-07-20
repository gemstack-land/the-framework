import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { formatSize, formatWorktreeList, type WorktreeRow } from './worktrees.js'

const row = (over: Partial<WorktreeRow> & { runId: string }): WorktreeRow => ({ live: false, ...over })

test('formatSize scales, and keeps one decimal only where it reads better (#752)', () => {
  assert.equal(formatSize(undefined), '-')
  assert.equal(formatSize(0), '0B')
  assert.equal(formatSize(900), '900B')
  assert.equal(formatSize(1536), '1.5KB')
  assert.equal(formatSize(20 * 1024), '20KB')
  assert.equal(formatSize(1024 * 1024 * 3.25), '3.3MB')
  assert.equal(formatSize(1024 ** 3 * 2), '2.0GB')
})

test('the worktrees table pads its columns and names every session (#752)', () => {
  const lines = formatWorktreeList([
    row({ runId: '2026-07-20T10-00-00-000Z', status: 'stopped', sizeBytes: 1536, branch: 'the-framework/add-login' }),
    row({ runId: '2026-07-19T09-00-00-000Z', status: 'failed' }),
    row({ runId: '2026-07-18T08-00-00-000Z', status: 'running', live: true }),
  ])
  assert.equal(lines[0], 'SESSION                   STATUS   SIZE   BRANCH')
  assert.equal(lines[1], '2026-07-20T10-00-00-000Z  stopped  1.5KB  the-framework/add-login')
  assert.equal(lines[2], '2026-07-19T09-00-00-000Z  failed   -      -', 'no size and no branch still line up')
  assert.equal(lines[3], '2026-07-18T08-00-00-000Z  running  -      -', 'a live session is listed, not hidden')
})

test('an empty list says why there is nothing rather than printing a bare header (#752)', () => {
  assert.deepEqual(formatWorktreeList([]), ['No worktrees. A session that finished cleanly does not keep one.'])
})

test('a worktree whose run left no meta is listed as unknown, not skipped (#752)', () => {
  const lines = formatWorktreeList([row({ runId: 'orphan' })])
  assert.equal(lines[1], 'orphan   unknown  -     -')
})
