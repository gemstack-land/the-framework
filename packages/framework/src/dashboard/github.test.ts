import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { githubUrlFromRemote, githubUrlFor } from './github.js'

test('githubUrlFromRemote normalizes the common remote forms', () => {
  const expected = 'https://github.com/gemstack-land/gemstack'
  assert.equal(githubUrlFromRemote('git@github.com:gemstack-land/gemstack.git'), expected)
  assert.equal(githubUrlFromRemote('git@github.com:gemstack-land/gemstack'), expected)
  assert.equal(githubUrlFromRemote('ssh://git@github.com/gemstack-land/gemstack.git'), expected)
  assert.equal(githubUrlFromRemote('https://github.com/gemstack-land/gemstack.git'), expected)
  assert.equal(githubUrlFromRemote('https://github.com/gemstack-land/gemstack'), expected)
  assert.equal(githubUrlFromRemote('https://user@github.com/gemstack-land/gemstack.git\n'), expected)
})

test('githubUrlFromRemote returns undefined for non-GitHub or junk remotes', () => {
  assert.equal(githubUrlFromRemote('git@gitlab.com:o/r.git'), undefined)
  assert.equal(githubUrlFromRemote('https://example.com/o/r.git'), undefined)
  assert.equal(githubUrlFromRemote('https://github.com/'), undefined)
  assert.equal(githubUrlFromRemote('https://github.com/only-owner'), undefined)
  assert.equal(githubUrlFromRemote(''), undefined)
})

test('githubUrlFor reads origin and returns undefined when git fails', async () => {
  assert.equal(
    await githubUrlFor('/x', async () => 'git@github.com:gemstack-land/gemstack.git\n'),
    'https://github.com/gemstack-land/gemstack',
  )
  assert.equal(
    await githubUrlFor('/x', async () => {
      throw new Error('no origin')
    }),
    undefined,
  )
})
