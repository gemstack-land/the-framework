import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readGitStatus } from './git-status.js'
import type { GitRunner } from '../project.js'

const gitWith =
  (branch: string, porcelain: string): GitRunner =>
  async args => {
    if (args[0] === 'rev-parse') return `${branch}\n`
    if (args[0] === 'status') return porcelain
    return ''
  }

test('readGitStatus reports branch, clean tree, and no PR', async () => {
  const status = await readGitStatus('/x', { git: gitWith('main', ''), pr: async () => undefined })
  assert.deepEqual(status, { branch: 'main', dirty: false })
})

test('readGitStatus flags a dirty tree and includes a linked PR', async () => {
  const pr = { number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', title: 'Add thing' }
  const status = await readGitStatus('/x', { git: gitWith('feat/x', ' M src/a.ts\n'), pr: async () => pr })
  assert.deepEqual(status, { branch: 'feat/x', dirty: true, pr })
})

test('readGitStatus returns undefined when the path is not a git repo', async () => {
  const status = await readGitStatus('/x', {
    git: async () => {
      throw new Error('not a git repository')
    },
    pr: async () => undefined,
  })
  assert.equal(status, undefined)
})

test('readGitStatus degrades to no PR when the lookup fails', async () => {
  const status = await readGitStatus('/x', {
    git: gitWith('main', ''),
    pr: async () => {
      throw new Error('gh not found')
    },
  })
  assert.deepEqual(status, { branch: 'main', dirty: false })
})
