import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { onProjectFiles, onProjectFileStatus, onRunWorktree } from './reads.telefunc.js'

// Outside a Telefunc `serve({ context })` the RPC resolves against the global registry, so an
// unknown project id has no local path — the same situation as the relay, which has no
// checkout. onProjectFiles (#504) must degrade to an empty list rather than throwing.

test('onProjectFiles for an unknown project returns an empty list', async () => {
  assert.deepEqual(await onProjectFiles('project-that-does-not-exist'), [])
})

test('onProjectFileStatus for an unknown project returns an empty map', async () => {
  assert.deepEqual(await onProjectFileStatus('project-that-does-not-exist'), {})
})

test('onRunWorktree for an unknown project returns null', async () => {
  assert.equal(await onRunWorktree('project-that-does-not-exist', '2026-07-19T10-00-00-000Z'), null)
})

test('onRunWorktree refuses a run id that could escape the worktrees dir', async () => {
  // The id names a directory, so it is guarded here as it is everywhere else it reaches a path.
  assert.equal(await onRunWorktree('project-that-does-not-exist', '../../etc'), null)
})
