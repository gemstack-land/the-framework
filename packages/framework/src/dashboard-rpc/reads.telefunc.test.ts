import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { onProjectFiles } from './reads.telefunc.js'

// Outside a Telefunc `serve({ context })` the RPC resolves against the global registry, so an
// unknown project id has no local path — the same situation as the relay, which has no
// checkout. onProjectFiles (#504) must degrade to an empty list rather than throwing.

test('onProjectFiles for an unknown project returns an empty list', async () => {
  assert.deepEqual(await onProjectFiles('project-that-does-not-exist'), [])
})
