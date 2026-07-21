import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ProjectSummary } from './dashboard/projects.js'
import type { GitRunner } from './project.js'
import {
  commitConversations,
  commitMessage,
  gitBusy,
  pendingConversations,
  startConversationCommitter,
  CONVERSATIONS_PATHSPEC,
  type PathProbe,
} from './conversation-commit.js'

const project = (path: string): ProjectSummary => ({ id: path, path, name: path, activated: true })

/** A git seam that records every invocation and answers from a per-subcommand script. */
function fakeGit(answers: Record<string, string | (() => string)> = {}) {
  const calls: string[][] = []
  const git: GitRunner = async args => {
    calls.push(args)
    const answer = answers[args[0] ?? '']
    if (answer === undefined) return ''
    return typeof answer === 'function' ? answer() : answer
  }
  const commits = () => calls.filter(args => args[0] === 'commit').length
  return { git, calls, commits }
}

const noLocks: PathProbe = async () => false

/** Let the constructor's immediate baseline poll finish, the way the watcher tests do. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('the pathspec names only the conversations directory (#912)', () => {
  assert.equal(CONVERSATIONS_PATHSPEC, '.the-framework/conversations')
})

test('pending conversations are parsed from porcelain and sorted (#912)', async () => {
  const { git, calls } = fakeGit({
    status: ['?? .the-framework/conversations/b.md', ' M .the-framework/conversations/a.md', ''].join('\n'),
  })
  assert.deepEqual(await pendingConversations('/repo', git), [
    '.the-framework/conversations/a.md',
    '.the-framework/conversations/b.md',
  ])
  assert.deepEqual(
    calls[0],
    ['status', '--porcelain', '-uall', '--', CONVERSATIONS_PATHSPEC],
    'the status read is path-scoped, and -uall names each untracked file',
  )
})

test('-uall is passed, or an untracked dir collapses to one unchanging entry (#912)', async () => {
  // Real git reports a wholly-untracked directory as a single `?? dir/` entry unless -uall is
  // given, which would make every burst look identical to the debounce and commit mid-write.
  const { git, calls } = fakeGit({ status: '' })
  await pendingConversations('/repo', git)
  assert.ok(calls[0]?.includes('-uall'), `status must ask for every untracked file, got ${JSON.stringify(calls[0])}`)
})

test('a rename reports the destination, and a quoted path is unquoted (#912)', async () => {
  const { git } = fakeGit({
    status: [
      'R  .the-framework/conversations/old.md -> .the-framework/conversations/new.md',
      '?? ".the-framework/conversations/sp ace.md"',
    ].join('\n'),
  })
  assert.deepEqual(await pendingConversations('/repo', git), [
    '.the-framework/conversations/new.md',
    '.the-framework/conversations/sp ace.md',
  ])
})

test('an unreadable repo reads as no changes rather than throwing (#912)', async () => {
  const git: GitRunner = async () => {
    throw new Error('not a git repository')
  }
  assert.deepEqual(await pendingConversations('/repo', git), [])
})

test('a locked index or an in-flight rebase means busy, so nothing is committed (#912)', async () => {
  const { git } = fakeGit({ 'rev-parse': '/repo/.git\n' })
  const only = (marker: string): PathProbe => async path => path === `/repo/.git/${marker}`

  assert.equal(await gitBusy('/repo', git, only('index.lock')), 'another git process holds the index lock')
  assert.equal(await gitBusy('/repo', git, only('rebase-merge')), 'a rebase is in progress')
  assert.equal(await gitBusy('/repo', git, only('rebase-apply')), 'a rebase is in progress')
  assert.equal(await gitBusy('/repo', git, only('MERGE_HEAD')), 'a merge is in progress')
  assert.equal(await gitBusy('/repo', git, only('CHERRY_PICK_HEAD')), 'a cherry-pick is in progress')
  assert.equal(await gitBusy('/repo', git, noLocks), undefined, 'a quiet repo is not busy')
})

test('the busy check resolves the real git dir, so a linked worktree is checked correctly (#912)', async () => {
  const { git } = fakeGit({ 'rev-parse': '/main/.git/worktrees/wt-1\n' })
  const probed: string[] = []
  const probe: PathProbe = async path => {
    probed.push(path)
    return false
  }
  await gitBusy('/wt-1', git, probe)
  assert.ok(probed.length > 0, 'the markers were probed')
  assert.ok(
    probed.every(path => path.startsWith('/main/.git/worktrees/wt-1/')),
    `markers are looked for in the resolved git dir, got ${probed[0]}`,
  )
})

test('a non-repo is busy rather than committed into (#912)', async () => {
  const git: GitRunner = async () => {
    throw new Error('fatal: not a git repository')
  }
  assert.equal(await gitBusy('/tmp/x', git, noLocks), 'not a git repository')
})

test('a commit stages and commits the pathspec, and never add -A (#912)', async () => {
  const { git, calls } = fakeGit({
    'rev-parse': '/repo/.git\n',
    status: '?? .the-framework/conversations/a.md',
  })
  const outcome = await commitConversations('/repo', git, noLocks)
  assert.deepEqual(outcome, { committed: true, files: ['.the-framework/conversations/a.md'] })

  assert.deepEqual(
    calls.find(args => args[0] === 'add'),
    ['add', '--', CONVERSATIONS_PATHSPEC],
    'staging is scoped to the pathspec',
  )
  assert.deepEqual(calls.find(args => args[0] === 'commit'), [
    'commit',
    '-m',
    '[The Framework] a conversation',
    '--',
    CONVERSATIONS_PATHSPEC,
  ])
  assert.ok(
    !calls.some(args => args.includes('-A') || args.includes('--all')),
    'the user checkout is never swept wholesale',
  )
})

test('a busy repo is skipped without staging anything (#912)', async () => {
  const { git, calls } = fakeGit({ 'rev-parse': '/repo/.git\n', status: '?? .the-framework/conversations/a.md' })
  const locked: PathProbe = async path => path.endsWith('index.lock')
  const outcome = await commitConversations('/repo', git, locked)
  assert.deepEqual(outcome, { committed: false, reason: 'another git process holds the index lock' })
  assert.ok(!calls.some(args => args[0] === 'add' || args[0] === 'commit'), 'nothing touched the index')
})

test('a clean checkout commits nothing (#912)', async () => {
  const { git, calls } = fakeGit({ 'rev-parse': '/repo/.git\n', status: '' })
  assert.deepEqual(await commitConversations('/repo', git, noLocks), {
    committed: false,
    reason: 'no conversation changes',
  })
  assert.ok(!calls.some(args => args[0] === 'commit'))
})

test('a failed commit is swallowed and reported, not thrown (#912)', async () => {
  const git: GitRunner = async args => {
    if (args[0] === 'rev-parse') return '/repo/.git\n'
    if (args[0] === 'status') return '?? .the-framework/conversations/a.md'
    if (args[0] === 'commit') throw new Error('nothing to commit')
    return ''
  }
  assert.deepEqual(await commitConversations('/repo', git, noLocks), {
    committed: false,
    reason: 'nothing to commit',
  })
})

test('the commit message counts the batch (#912)', () => {
  assert.equal(commitMessage(['a']), '[The Framework] a conversation')
  assert.equal(commitMessage(['a', 'b']), '[The Framework] 2 conversations')
})

test('a conversation still being written is not committed until it settles (#912)', async () => {
  let listing = '?? .the-framework/conversations/a.md'
  const { git, commits } = fakeGit({ 'rev-parse': '/repo/.git\n', status: () => listing })
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000, // effectively disable the timer; drive via poll()
  })
  try {
    await settle() // the constructor's baseline poll opens the idle window on {a}
    assert.equal(commits(), 0, 'the first sighting only starts the idle window')

    listing = ['?? .the-framework/conversations/a.md', '?? .the-framework/conversations/b.md'].join('\n')
    await committer.poll()
    assert.equal(commits(), 0, 'a changed pending set restarts the window rather than committing mid-burst')

    await committer.poll()
    assert.equal(commits(), 1, 'an unchanged pending set is settled, so the batch commits')

    listing = ''
    await committer.poll()
    assert.equal(commits(), 1, 'a now-clean checkout adds no further commits')
  } finally {
    committer.stop()
  }
})

test('a conversation that never goes idle still commits once max wait lapses (#912)', async () => {
  let n = 0
  let clock = 0
  const { git, commits } = fakeGit({
    'rev-parse': '/repo/.git\n',
    // Every poll sees a different pending set, so the idle window alone would never fire.
    status: () => `?? .the-framework/conversations/${n++}.md`,
  })
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
    maxWaitMs: 100,
    now: () => clock,
  })
  try {
    await settle()
    clock = 50
    await committer.poll()
    assert.equal(commits(), 0, 'still inside the cap, and never idle')

    clock = 150
    await committer.poll()
    assert.equal(commits(), 1, 'the cap forces the batch through')
  } finally {
    committer.stop()
  }
})

test('a busy repo keeps its place, so the next window retries it (#912)', async () => {
  let locked = true
  const { git, commits } = fakeGit({ 'rev-parse': '/repo/.git\n', status: '?? .the-framework/conversations/a.md' })
  const exists: PathProbe = async path => locked && path.endsWith('index.lock')
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists,
    intervalMs: 1_000_000,
  })
  try {
    await settle()
    await committer.poll() // settled, but the repo is busy
    assert.equal(commits(), 0, 'a locked index blocks the commit')

    locked = false
    await committer.poll()
    assert.equal(commits(), 1, 'the retry lands as soon as the repo is free')
  } finally {
    committer.stop()
  }
})

test('a failing commit logs its reason once, not once per poll', async () => {
  const { git } = fakeGit({
    'rev-parse': '/repo/.git\n',
    status: '?? .the-framework/conversations/a.md',
    commit: () => {
      throw new Error('nothing added to commit')
    },
  })
  const logs: string[] = []
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
    log: message => logs.push(message),
  })
  try {
    await settle() // the baseline poll only opens the idle window
    assert.deepEqual(logs, [], 'nothing has been attempted yet')

    await committer.poll() // settled, so the commit is attempted and fails
    assert.equal(logs.length, 1, `the first failure is announced, got ${JSON.stringify(logs)}`)
    assert.match(logs[0] ?? '', /nothing added to commit/, 'the reason is in the message')
    assert.match(logs[0] ?? '', /\/repo/, 'the project is named')

    await committer.poll()
    await committer.poll()
    assert.equal(logs.length, 1, `an unchanged reason stays quiet, got ${JSON.stringify(logs)}`)
  } finally {
    committer.stop()
  }
})

test('a changed failure reason is announced again', async () => {
  let reason = 'first failure'
  const { git } = fakeGit({
    'rev-parse': '/repo/.git\n',
    status: '?? .the-framework/conversations/a.md',
    commit: () => {
      throw new Error(reason)
    },
  })
  const logs: string[] = []
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
    log: message => logs.push(message),
  })
  try {
    await settle()
    await committer.poll()
    await committer.poll()
    assert.equal(logs.length, 1, `one reason, one line, got ${JSON.stringify(logs)}`)

    reason = 'second failure'
    await committer.poll()
    assert.equal(logs.length, 2, `a new reason is diagnosable, got ${JSON.stringify(logs)}`)
    assert.match(logs[1] ?? '', /second failure/)
  } finally {
    committer.stop()
  }
})

test('the ordinary idle case is not announced as a failure', async () => {
  // The poll sees a pending file, but the commit's own re-read finds it already gone: an
  // everyday race, not something to log.
  const file = '?? .the-framework/conversations/a.md'
  let reads = 0
  const { git, commits } = fakeGit({
    'rev-parse': '/repo/.git\n',
    // Calls 1 and 2 are the poller's own reads; every later odd call is the commit's re-read.
    status: () => (++reads <= 2 ? file : reads % 2 === 1 ? '' : file),
  })
  const logs: string[] = []
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
    log: message => logs.push(message),
  })
  try {
    await settle()
    await committer.poll()
    await committer.poll()
    assert.equal(commits(), 0, 'there was nothing to commit')
    assert.deepEqual(logs, [], 'an empty batch is not a failure')
  } finally {
    committer.stop()
  }
})

test('a project scan that throws costs one window rather than the committer (#912)', async () => {
  const { git } = fakeGit({ 'rev-parse': '/repo/.git\n', status: '?? .the-framework/conversations/a.md' })
  const committer = startConversationCommitter({
    projects: async () => {
      throw new Error('registry unreadable')
    },
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
  })
  try {
    await settle()
    await committer.poll() // must not reject
  } finally {
    committer.stop()
  }
})

test('flush commits immediately, skipping the idle window, and counts projects (#912)', async () => {
  const { git, commits } = fakeGit({ 'rev-parse': '/repo/.git\n', status: '?? .the-framework/conversations/a.md' })
  const committer = startConversationCommitter({
    projects: async () => [project('/a'), project('/b')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
  })
  try {
    await settle()
    assert.equal(commits(), 0, 'the baseline poll alone commits nothing')
    assert.equal(await committer.flush(), 2, 'both projects committed on the first call, with no settling')
    assert.equal(commits(), 2)
  } finally {
    committer.stop()
  }
})

test('a stopped committer does not poll again (#912)', async () => {
  const { git, commits } = fakeGit({ 'rev-parse': '/repo/.git\n', status: '?? .the-framework/conversations/a.md' })
  const committer = startConversationCommitter({
    projects: async () => [project('/repo')],
    git,
    exists: noLocks,
    intervalMs: 1_000_000,
  })
  await settle()
  committer.stop()
  await committer.poll()
  await committer.poll()
  assert.equal(commits(), 0, 'a stopped committer commits nothing, however often it is driven')
})
