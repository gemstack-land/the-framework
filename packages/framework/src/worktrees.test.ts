import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { formatWorktreeList, type WorktreeRow } from './worktrees.js'

const row = (over: Partial<WorktreeRow> & { runId: string }): WorktreeRow => ({ live: false, ...over })

test('the worktrees table pads its columns and names every session (#752)', () => {
  const lines = formatWorktreeList([
    row({ runId: '2026-07-20T10-00-00-000Z', status: 'stopped', sizeBytes: 1536, branch: 'the-framework/add-login' }),
    row({ runId: '2026-07-19T09-00-00-000Z', status: 'failed' }),
    row({ runId: '2026-07-18T08-00-00-000Z', status: 'running', live: true }),
  ])
  assert.equal(lines[0], 'SESSION                   STATUS   SIZE    BRANCH')
  assert.equal(lines[1], '2026-07-20T10-00-00-000Z  stopped  1.5 KB  the-framework/add-login')
  assert.equal(lines[2], '2026-07-19T09-00-00-000Z  failed   -       -', 'no size and no branch still line up')
  assert.equal(lines[3], '2026-07-18T08-00-00-000Z  running  -       -', 'a live session is listed, not hidden')
})

test('an empty list says why there is nothing rather than printing a bare header (#752)', () => {
  assert.deepEqual(formatWorktreeList([]), ['No worktrees. A session that finished cleanly does not keep one.'])
})

test('a worktree whose run left no meta is listed as unknown, not skipped (#752)', () => {
  const lines = formatWorktreeList([row({ runId: 'orphan' })])
  assert.equal(lines[1], 'orphan   unknown  -     -')
})
