import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { promoteQueue } from './queue-promote.js'
import type { GitRunner } from './project.js'

// Pins the retry contract auto PM acts on: the callee flags the one retryable skip, so the
// daemon never has to string-match the prose reason (which a copyedit would silently break).

test('a dirty queue file is the one retryable skip (#852/#855)', async () => {
  const git: GitRunner = async args => {
    if (args[0] === 'show' && String(args[1]).startsWith('work:')) return '- queue entry\n'
    if (args[0] === 'show') return '- older entry\n'
    if (args[0] === 'status') return ' M TODO_AGENTS.md\n'
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  const outcome = await promoteQueue('/repo', { id: 'r1', branch: 'work' }, git)
  assert.deepEqual(outcome, { promoted: false, reason: 'the checkout has uncommitted queue changes', retry: true })
})

test('a run with no branch, or no queue file on it, is a final skip (no retry flag)', async () => {
  const noBranch = await promoteQueue('/repo', { id: 'r1' })
  assert.equal(noBranch.promoted, false)
  assert.ok(!('retry' in noBranch && noBranch.retry), 'no branch is final')

  const git: GitRunner = async args => {
    if (args[0] === 'show') throw new Error('path does not exist')
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  const noFile = await promoteQueue('/repo', { id: 'r1', branch: 'work' }, git)
  assert.equal(noFile.promoted, false)
  assert.ok(!('retry' in noFile && noFile.retry), 'no queue file is final')
})
