import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readRunHandoff, resolveRunPr, runBranchFor, pushRunBranch, openRunPullRequest, gitReason, runAutoHandoff, isSessionBranch, prBaseName, commitSessionWork, withheldMerge } from './run-handoff.js'
import { pickRunPr } from './gh.js'
import { nodeGitRunner, GIT_SLOW_TIMEOUT_MS, type GitRunner } from '../project.js'
import { CliTimeoutError, isCliTimeout } from '../cli-exec.js'

const exec = promisify(execFile)
const SEP = String.fromCharCode(31)

/** A GitRunner answering from a table, recording what it was asked. */
function fakeGit(answers: Record<string, string>): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const git: GitRunner = async args => {
    calls.push(args)
    const key = args.join(' ')
    const hit = Object.entries(answers).find(([prefix]) => key.startsWith(prefix))
    if (!hit) throw new Error(`no stub for: ${key}`)
    return hit[1]
  }
  return { git, calls }
}

const REPO = { 'rev-parse --git-dir': '.git' }

test('the recorded branch wins over both derivations (#799)', () => {
  assert.equal(runBranchFor({ id: 'r1', branch: 'feat/mine', sessionName: 'named' }), 'feat/mine')
  assert.equal(runBranchFor({ id: 'r1', sessionName: 'named' }), 'the-framework/named')
  assert.equal(runBranchFor({ id: 'r1' }), 'the-framework/run-r1')
})

test('a non-repo yields no handoff at all', async () => {
  const { git } = fakeGit({})
  assert.equal(await readRunHandoff('/nowhere', 'b', { git }), undefined)
})

test('a branch that no longer exists reports exists:false rather than failing', async () => {
  const { git } = fakeGit({ ...REPO, 'rev-parse --verify --quiet refs/heads/gone': '', remote: 'origin\n' })
  const handoff = await readRunHandoff('/repo', 'gone', { git, pr: async () => undefined })
  assert.equal(handoff?.exists, false)
  assert.equal(handoff?.empty, true)
  assert.equal(handoff?.hasRemote, true)
})

test('a session that changed nothing is reported empty, not as an empty branch', async () => {
  const { git } = fakeGit({
    ...REPO,
    'rev-parse --verify --quiet refs/heads/the-framework/quiet': 'abc123\n',
    remote: 'origin\n',
    'symbolic-ref': 'origin/main\n',
    log: '',
    diff: '',
    'rev-parse --verify --quiet refs/remotes': '',
    branch: '',
  })
  const handoff = await readRunHandoff('/repo', 'the-framework/quiet', { git, pr: async () => undefined })
  assert.equal(handoff?.empty, true)
  assert.deepEqual(handoff?.commits, [])
  assert.equal(handoff?.insertions, 0)
})

test('commits, files and line counts come back for a branch with work', async () => {
  const { git } = fakeGit({
    ...REPO,
    'rev-parse --verify --quiet refs/heads/the-framework/work': 'tip\n',
    remote: 'origin\n',
    'symbolic-ref': 'origin/main\n',
    log: `deadbeefcafe${SEP}add the thing\nfeedface1234${SEP}fix: a subject with spaces\n`,
    diff: '3\t1\tsrc/a.ts\n-\t-\tlogo.png\n',
    'rev-parse --verify --quiet refs/remotes/origin/the-framework/work': 'tip\n',
    branch: '',
  })
  const handoff = await readRunHandoff('/repo', 'the-framework/work', { git, pr: async () => undefined })
  assert.equal(handoff?.empty, false)
  assert.equal(handoff?.base, 'origin/main')
  assert.deepEqual(
    handoff?.commits.map(c => [c.short, c.subject]),
    [
      ['deadbee', 'add the thing'],
      ['feedfac', 'fix: a subject with spaces'],
    ],
  )
  assert.equal(handoff?.insertions, 3)
  assert.equal(handoff?.deletions, 1)
  // A binary file is listed but contributes no line counts.
  assert.equal(handoff?.files.find(f => f.path === 'logo.png')?.binary, true)
  // The remote is at the same commit, so there is nothing to push.
  assert.equal(handoff?.pushed, true)
})

test('an unpushed branch and a repo with no remote are distinguished', async () => {
  const base = {
    ...REPO,
    'rev-parse --verify --quiet refs/heads/b': 'tip\n',
    'symbolic-ref': 'origin/main\n',
    log: `sha${SEP}s\n`,
    diff: '1\t0\ta.ts\n',
    branch: '',
  }
  const unpushed = await readRunHandoff('/repo', 'b', {
    git: fakeGit({ ...base, remote: 'origin\n', 'rev-parse --verify --quiet refs/remotes': '' }).git,
    pr: async () => undefined,
  })
  assert.equal(unpushed?.hasRemote, true)
  assert.equal(unpushed?.pushed, false)

  const noRemote = await readRunHandoff('/repo', 'b', {
    git: fakeGit({ ...base, remote: '' }).git,
    pr: async () => undefined,
  })
  assert.equal(noRemote?.hasRemote, false)
  assert.equal(noRemote?.pushed, false)
})

test('the PR is looked up for the session branch, not the checkout HEAD (#799)', async () => {
  const { git } = fakeGit({
    ...REPO,
    'rev-parse --verify --quiet refs/heads/the-framework/x': 'tip\n',
    remote: 'origin\n',
    'symbolic-ref': 'origin/main\n',
    log: `sha${SEP}s\n`,
    diff: '',
    'rev-parse --verify --quiet refs/remotes': '',
    branch: '',
  })
  const asked: string[] = []
  const handoff = await readRunHandoff('/repo', 'the-framework/x', {
    git,
    pr: async (_cwd, branch) => {
      asked.push(branch)
      return { number: 7, url: 'https://example.test/7', state: 'OPEN', title: 'the pr' }
    },
  })
  assert.deepEqual(asked, ['the-framework/x'])
  assert.equal(handoff?.pr?.number, 7)
})

test('a failed push comes back as an error rather than throwing', async () => {
  const git: GitRunner = async () => {
    throw new Error('no upstream configured')
  }
  const result = await pushRunBranch('/repo', 'b', git)
  assert.deepEqual(result, { ok: false, error: 'no upstream configured' })
})

test('a timed-out push says so instead of reading like a rejected push (#997)', async () => {
  const git: GitRunner = async args => {
    throw new CliTimeoutError('git', args, GIT_SLOW_TIMEOUT_MS)
  }
  const result = await pushRunBranch('/repo', 'b', git)
  assert.equal(result.ok, false)
  const error = result.ok === false ? result.error : ''
  // A SIGTERM'd push has empty stderr, so this used to surface as a bare 'Command failed: git push'.
  assert.match(error, /timed out after 120000ms/)
  assert.match(error, /push --set-upstream origin b/)
})

test('a timeout is distinguishable from a git rejection (#997)', () => {
  assert.equal(isCliTimeout(new CliTimeoutError('git', ['push'], 120_000)), true)
  assert.equal(isCliTimeout(new Error("fatal: 'origin' does not appear to be a git repository")), false)
})

test("a push failure shows git's reason, not the command echoed back", () => {
  // execFile buries the useful line under its own 'Command failed:' preamble.
  const err = new Error("Command failed: git push --set-upstream origin b\nfatal: 'origin' does not appear to be a git repository\n")
  assert.equal(gitReason(err), "fatal: 'origin' does not appear to be a git repository")
  assert.equal(gitReason(new Error('something odd')), 'something odd')
})

test('opening a PR pushes first and returns the URL gh printed', async () => {
  const pushes: string[][] = []
  const ghCalls: string[][] = []
  const result = await openRunPullRequest(
    '/repo',
    'the-framework/x',
    { title: 'A title', body: 'A body', base: 'main' },
    {
      git: async args => {
        pushes.push(args)
        return ''
      },
      gh: async args => {
        ghCalls.push(args)
        return 'https://github.com/o/r/pull/12\n'
      },
    },
  )
  assert.deepEqual(result, { ok: true, url: 'https://github.com/o/r/pull/12' })
  assert.deepEqual(pushes, [['push', '--set-upstream', 'origin', 'the-framework/x']])
  const args = ghCalls[0] ?? []
  assert.deepEqual(args.slice(0, 4), ['pr', 'create', '--head', 'the-framework/x'])
  assert.ok(args.includes('--base') && args.includes('main'))
  // Not a draft: the interventions queue (#632) lists open non-draft PRs as "needs you".
  assert.ok(!args.includes('--draft'))
})

test('a PR is not opened when the push fails', async () => {
  let ghRan = false
  const result = await openRunPullRequest(
    '/repo',
    'b',
    { title: 't', body: 'b' },
    {
      git: async () => {
        throw new Error('remote rejected')
      },
      gh: async () => {
        ghRan = true
        return ''
      },
    },
  )
  assert.deepEqual(result, { ok: false, error: 'remote rejected' })
  assert.equal(ghRan, false)
})

test('a real repo: the branch outlives its worktree and still reports its work (#799)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-'))
  const git = nodeGitRunner()
  try {
    await exec('git', ['init', '-b', 'main', dir])
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'README.md'), 'base\n')
    await exec('git', ['add', '-A'], { cwd: dir })
    await exec('git', ['commit', '-m', 'base'], { cwd: dir })

    // A session's work, on its own branch, exactly as teardown leaves it.
    await exec('git', ['checkout', '-b', 'the-framework/demo'], { cwd: dir })
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'app.ts'), 'export const a = 1\n')
    await exec('git', ['add', '-A'], { cwd: dir })
    await exec('git', ['commit', '-m', 'add the app'], { cwd: dir })
    await exec('git', ['checkout', 'main'], { cwd: dir })

    // Read from the project checkout, which is on main, about the session's branch.
    const handoff = await readRunHandoff(dir, 'the-framework/demo', { git, pr: async () => undefined })
    assert.equal(handoff?.exists, true)
    assert.equal(handoff?.empty, false)
    assert.equal(handoff?.base, 'main')
    assert.deepEqual(handoff?.commits.map(c => c.subject), ['add the app'])
    assert.deepEqual(handoff?.files.map(f => f.path), ['src/app.ts'])
    assert.equal(handoff?.insertions, 1)
    assert.equal(handoff?.hasRemote, false)
    assert.equal(handoff?.merged, false)

    // And a branch already merged into the base says so.
    await exec('git', ['merge', '--no-ff', '-m', 'merge', 'the-framework/demo'], { cwd: dir })
    const merged = await readRunHandoff(dir, 'the-framework/demo', { git, pr: async () => undefined })
    assert.equal(merged?.merged, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a real repo: a branch whose work is already in the base reports empty (#1164/#1173)', async () => {
  // The bug this pins: the commit list used `base...branch`, git's SYMMETRIC difference, so a
  // branch that had produced nothing of its own still reported the commits that were only on the
  // base. `empty` stayed false, the dashboard offered Open PR, and GitHub refused it with
  // "No commits between main and <branch>" — an action that could only ever fail.
  const dir = await mkdtemp(join(tmpdir(), 'handoff-merged-'))
  const git = nodeGitRunner()
  try {
    await exec('git', ['init', '-b', 'main', dir])
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'README.md'), 'base\n')
    await exec('git', ['add', '-A'], { cwd: dir })
    await exec('git', ['commit', '-m', 'base'], { cwd: dir })

    // The session branches off and commits nothing: its edit was never committed, which is the
    // shape a run that forgets to commit leaves behind.
    await exec('git', ['branch', 'the-framework/demo'], { cwd: dir })
    // Meanwhile the base moves on, which is the ordinary case on a repo anyone else is working in.
    await writeFile(join(dir, 'README.md'), 'base, moved on\n')
    await exec('git', ['commit', '-am', 'someone else landed this'], { cwd: dir })

    const handoff = await readRunHandoff(dir, 'the-framework/demo', { git, pr: async () => undefined })
    assert.equal(handoff?.exists, true)
    assert.deepEqual(handoff?.commits, [], 'the base\'s own commits are not this session\'s work')
    assert.equal(handoff?.empty, true, 'so there is nothing to open a PR for, and the bar says so')
    assert.deepEqual(handoff?.files, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// The end-of-session handoff that fires by itself (#1102).

/** A branch with one commit, a remote, and no PR: the case a handoff should act on. */
const READY = {
  ...REPO,
  'rev-parse --verify --quiet refs/heads/the-framework/x': 'abc123\n',
  remote: 'origin\n',
  'symbolic-ref': 'origin/main\n',
  log: `abc123${SEP}abc${SEP}did the thing`,
  diff: '1\t0\tsrc/app.ts',
  'rev-parse --verify --quiet refs/remotes': '',
  branch: '',
}

test('an armed session opens a DRAFT PR, and pushes on the way (#1102)', async () => {
  const gh: string[][] = []
  const { git } = fakeGit({ ...READY, push: '' })
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x', sessionName: 'x', intent: 'build it' },
    { push: true, pr: true },
    {
      git,
      pr: async () => undefined,
      gh: async args => {
        gh.push(args)
        return 'https://github.com/o/r/pull/9\n'
      },
    },
  )
  assert.deepEqual(outcome, { outcome: 'done', pushed: true, url: 'https://github.com/o/r/pull/9' })
  // The draft flag is the whole reason this is safe to fire on every session: without it every
  // finished run would put a review request in someone's inbox.
  assert.ok(gh[0]?.includes('--draft'), `expected --draft in ${JSON.stringify(gh[0])}`)
  assert.ok(gh[0]?.includes('the-framework/x'))
})

test('push armed alone pushes and opens nothing (#1102)', async () => {
  const pushes: string[][] = []
  const { git: read } = fakeGit(READY)
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: false },
    {
      git: async (args, cwd) => {
        if (args[0] === 'push') {
          pushes.push(args)
          return ''
        }
        return read(args, cwd)
      },
      pr: async () => undefined,
      gh: async () => assert.fail('no PR should be opened when only the push is armed'),
    },
  )
  assert.deepEqual(outcome, { outcome: 'done', pushed: true })
  assert.deepEqual(pushes, [['push', '--set-upstream', 'origin', 'the-framework/x']])
})

test('a disarmed session hands off nothing at all (#1102)', async () => {
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: false, pr: false },
    { git: async () => assert.fail('a disarmed handoff must not touch git'), gh: async () => assert.fail('nor gh') },
  )
  assert.deepEqual(outcome, { outcome: 'skipped', reason: 'not-armed' })
})

test('a branch that already has a PR is never given a second one (#1102)', async () => {
  const { git } = fakeGit(READY)
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true },
    {
      git,
      pr: async () => ({ number: 4, url: 'https://github.com/o/r/pull/4', state: 'OPEN', title: 'already' }),
      gh: async () => assert.fail('opening a second PR is the one mistake this must not make'),
    },
  )
  assert.deepEqual(outcome, { outcome: 'skipped', reason: 'already-open' })
})

test('an armed merge follows the PR it just opened (#1216)', async () => {
  const gh: string[][] = []
  const { git } = fakeGit({ ...READY, push: '' })
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x', sessionName: 'x', intent: 'build it' },
    { push: true, pr: true, merge: true },
    {
      git,
      pr: async () => undefined,
      gh: async args => {
        gh.push(args)
        return args[1] === 'create' ? 'https://github.com/o/r/pull/9\n' : ''
      },
    },
  )
  // Auto-merge first: the PR lands when its checks pass, not before them.
  assert.deepEqual(gh[1], ['pr', 'merge', '9', '--squash', '--auto'])
  // Ready, not draft: GitHub refuses to merge drafts, so an armed merge and --draft are
  // mutually exclusive on the same PR.
  assert.ok(!gh[0]?.includes('--draft'), `expected no --draft in ${JSON.stringify(gh[0])}`)
  assert.deepEqual(outcome, {
    outcome: 'done',
    pushed: true,
    url: 'https://github.com/o/r/pull/9',
    merge: { outcome: 'auto-armed' },
  })
})

test('without the merge flag the PR is left alone, exactly as before (#1216)', async () => {
  const gh: string[][] = []
  const { git } = fakeGit({ ...READY, push: '' })
  await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true },
    { git, pr: async () => undefined, gh: async args => (gh.push(args), 'https://github.com/o/r/pull/9\n') },
  )
  assert.deepEqual(gh.map(args => args[1]), ['create'], 'no merge call without the flag')
})

test('a merge that fails is reported on a handoff that still succeeded (#1216)', async () => {
  // The PR exists either way; a human can still merge it by hand. Turning the refusal into a
  // failed handoff would misreport the half that worked.
  const { git } = fakeGit({ ...READY, push: '' })
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true, merge: true },
    {
      git,
      pr: async () => undefined,
      gh: async args => {
        if (args[1] === 'create') return 'https://github.com/o/r/pull/9\n'
        throw new Error('GraphQL: Base branch was modified')
      },
    },
  )
  assert.equal(outcome.outcome, 'done')
  assert.deepEqual('merge' in outcome ? outcome.merge : undefined, {
    outcome: 'failed',
    error: 'GraphQL: Base branch was modified',
  })
})

test('an armed merge takes the already-open PR a predecessor left (#1216)', async () => {
  // A daemon restart or rerun finds the PR its predecessor opened: the merge is the half that
  // has not happened yet, and the skip reason still says why no second PR was opened.
  const gh: string[][] = []
  const { git } = fakeGit(READY)
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true, merge: true },
    {
      git,
      pr: async () => ({ number: 4, url: 'https://github.com/o/r/pull/4', state: 'OPEN', title: 'already' }),
      gh: async args => (gh.push(args), ''),
    },
  )
  assert.deepEqual(gh, [['pr', 'merge', '4', '--squash', '--auto']])
  assert.deepEqual(outcome, { outcome: 'skipped', reason: 'already-open', merge: { outcome: 'auto-armed' } })
})

test('a session that committed nothing is not published (#1102)', async () => {
  const { git } = fakeGit({ ...READY, log: '', diff: '' })
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true },
    { git, pr: async () => undefined, gh: async () => assert.fail('nothing to open a PR for') },
  )
  assert.deepEqual(outcome, { outcome: 'skipped', reason: 'no-commits' })
})

test('a branch of pure framework bookkeeping is empty, and is not published (#1291)', async () => {
  // The observed junk PR: one "[The Framework] Uncommited changes" commit sweeping in the
  // conversation record the daemon wrote at start, and nothing else on the branch.
  const bookkeeping = {
    ...READY,
    log: `abc123${SEP}[The Framework] Uncommited changes`,
    diff: '21\t0\t.the-framework/conversations/2026-07-27T14-21-36-276Z.md\n2\t0\t.the-framework/LOGS.md',
  }
  const { git } = fakeGit(bookkeeping)
  const handoff = await readRunHandoff('/repo', 'the-framework/x', { git, pr: async () => undefined })
  assert.equal(handoff?.empty, true, 'paper trail is provenance, not work')
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true },
    { git: fakeGit(bookkeeping).git, pr: async () => undefined, gh: async () => assert.fail('nothing to publish') },
  )
  assert.deepEqual(outcome, { outcome: 'skipped', reason: 'no-commits' })
})

test('bookkeeping alongside real work does not make a branch empty (#1291)', async () => {
  const { git } = fakeGit({
    ...READY,
    diff: '21\t0\t.the-framework/conversations/r1.md\n3\t1\tsrc/app.ts',
  })
  const handoff = await readRunHandoff('/repo', 'the-framework/x', { git, pr: async () => undefined })
  assert.equal(handoff?.empty, false)
})

test('a repo with no remote is a skip, not a failure (#1102)', async () => {
  const { git } = fakeGit({ ...READY, remote: '' })
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: true },
    { git, pr: async () => undefined, gh: async () => assert.fail('nowhere to push to') },
  )
  assert.deepEqual(outcome, { outcome: 'skipped', reason: 'no-remote' })
})

test('a failed push is reported with git’s own reason, so the bar can offer the retry (#1102)', async () => {
  const { git: read } = fakeGit(READY)
  const outcome = await runAutoHandoff(
    '/repo',
    { id: 'r1', branch: 'the-framework/x' },
    { push: true, pr: false },
    {
      git: async (args, cwd) => {
        if (args[0] === 'push') throw new Error('Command failed: git push\nfatal: no write access\n')
        return read(args, cwd)
      },
      pr: async () => undefined,
    },
  )
  assert.deepEqual(outcome, { outcome: 'failed', step: 'push', error: 'fatal: no write access' })
})

test('a session branch is recognised by its prefix, a hand-made one is not (#1102)', () => {
  assert.equal(isSessionBranch('the-framework/x'), true)
  assert.equal(isSessionBranch('feat/mine'), false)
  assert.equal(isSessionBranch(undefined), false)
})

test('the PR base is the remote branch name, not the tracking ref (#1102)', async () => {
  // Found by driving this against a real GitHub remote: `base` is `origin/main`, because that is
  // what the log range and the merged check need, but `gh pr create --base origin/main` is
  // rejected with "Base ref must be a branch". Pre-existing in #799's Open PR button; auto-handoff
  // made it fire on every session.
  assert.equal(prBaseName('origin/main'), 'main')
  assert.equal(prBaseName('main'), 'main') // the no-remote fallback is already a branch name
  assert.equal(prBaseName('origin/release/2.x'), 'release/2.x')

  const ghCalls: string[][] = []
  await openRunPullRequest(
    '/repo',
    'the-framework/x',
    { title: 't', body: 'b', base: 'origin/main' },
    {
      git: async () => '',
      gh: async args => {
        ghCalls.push(args)
        return 'https://github.com/o/r/pull/1\n'
      },
    },
  )
  const at = ghCalls[0]?.indexOf('--base') ?? -1
  assert.notEqual(at, -1, 'the base should still be passed')
  assert.equal(ghCalls[0]?.[at + 1], 'main')
})

test('uncommitted work is counted from the session checkout, not the project (#1173)', async () => {
  const { git, calls } = fakeGit({
    ...REPO,
    'rev-parse --verify --quiet refs/heads/the-framework/dirty': 'abc123\n',
    remote: 'origin\n',
    'symbolic-ref': 'origin/main\n',
    log: '',
    diff: '',
    'rev-parse --verify --quiet refs/remotes': '',
    branch: '',
    status: ' M src/app.ts\n?? src/new.ts\n',
  })
  const handoff = await readRunHandoff('/repo', 'the-framework/dirty', {
    git,
    pr: async () => undefined,
    checkout: '/repo/.the-framework/worktrees/r1',
  })
  // The branch really is empty; the work is real and sitting next to it. Both are true at once,
  // which is the whole of #1173 — and the paths are what the bar names instead of a dead button.
  assert.equal(handoff?.empty, true)
  assert.deepEqual(handoff?.pendingFiles, ['src/app.ts', 'src/new.ts'])
  assert.ok(calls.some(args => args[0] === 'status'), 'the checkout should have been asked')
})

test('pending is absent, not zero, when no session checkout was given (#1173)', async () => {
  const { git, calls } = fakeGit({
    ...REPO,
    'rev-parse --verify --quiet refs/heads/the-framework/quiet': 'abc123\n',
    remote: 'origin\n',
    'symbolic-ref': 'origin/main\n',
    log: '',
    diff: '',
    'rev-parse --verify --quiet refs/remotes': '',
    branch: '',
  })
  const handoff = await readRunHandoff('/repo', 'the-framework/quiet', { git, pr: async () => undefined })
  // "Nobody asked" must not read as "asked, tree clean": only the second may be shown as a dead end.
  assert.equal(handoff?.pendingFiles, undefined)
  assert.ok(!calls.some(args => args[0] === 'status'), 'no checkout means no status read')
})

test('commitSessionWork leaves the project checkout and other branches alone (#1173)', async () => {
  const onBranch = fakeGit({ 'rev-parse --abbrev-ref HEAD': 'main\n' })
  // The checkout IS the project root: the dirt there is the user's, whatever branch it is on. This
  // is what `resolveRunCheckout` falls back to once a session's worktree is gone.
  assert.equal(await commitSessionWork('/repo', '/repo', 'the-framework/x', onBranch.git), true)
  assert.equal(onBranch.calls.length, 0, 'the project root should not even be inspected')

  // Its own checkout, but parked on another branch: not this session's work to commit.
  const elsewhere = fakeGit({ 'rev-parse --abbrev-ref HEAD': 'main\n' })
  assert.equal(await commitSessionWork('/wt', '/repo', 'the-framework/x', elsewhere.git), true)
  assert.ok(!elsewhere.calls.some(args => args[0] === 'commit'), 'nothing should be committed')
})

test('a real repo: the finishing step commits what the agent left in its worktree (#1173)', async () => {
  // Rom's dead-end session, reproduced end to end: the agent edited a file, never committed, and
  // the branch was 0 commits ahead, so `gh pr create` could only answer "No commits between main
  // and the-framework/run-r1".
  const dir = await mkdtemp(join(tmpdir(), 'handoff-settle-'))
  const git = nodeGitRunner()
  const branch = 'the-framework/run-r1'
  try {
    await exec('git', ['init', '-b', 'main', dir])
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'README.md'), 'base\n')
    await exec('git', ['add', '-A'], { cwd: dir })
    await exec('git', ['commit', '-m', 'base'], { cwd: dir })

    // The session's own checkout, as #453 allocates it.
    const checkout = join(dir, '.the-framework', 'worktrees', 'r1')
    await exec('git', ['worktree', 'add', '-b', branch, checkout], { cwd: dir })
    await writeFile(join(checkout, 'index.html'), '<h1>hi</h1>\n')

    const before = await readRunHandoff(dir, branch, { git, pr: async () => undefined, checkout })
    assert.equal(before?.empty, true, 'the branch carries nothing yet')
    assert.deepEqual(before?.pendingFiles, ['index.html'], 'and the work is sitting in the checkout, by name')

    assert.equal(await commitSessionWork(checkout, dir, branch, git), true)

    const after = await readRunHandoff(dir, branch, { git, pr: async () => undefined, checkout })
    assert.equal(after?.empty, false, 'the work is on the branch now, so a PR has something to say')
    assert.deepEqual(after?.pendingFiles, [])
    assert.deepEqual(after?.commits.map(c => c.subject), ['[The Framework] uncommitted changes'])
    assert.deepEqual(after?.files.map(f => f.path), ['index.html'])

    // Idempotent: pressing the button twice must not make an empty commit.
    assert.equal(await commitSessionWork(checkout, dir, branch, git), true)
    const again = await readRunHandoff(dir, branch, { git, pr: async () => undefined, checkout })
    assert.equal(again?.commits.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickRunPr trusts an open PR, and otherwise only one created after the run started (#1251)', () => {
  const stale = { number: 1177, url: 'u1177', state: 'MERGED', title: 'old triage', createdAt: '2026-07-25T16:55:18Z' }
  const own = { number: 1249, url: 'u1249', state: 'MERGED', title: 'this triage', createdAt: '2026-07-26T21:35:13Z' }
  const later = { number: 1300, url: 'u1300', state: 'MERGED', title: 'even later', createdAt: '2026-07-26T23:00:00Z' }
  const open = { number: 1301, url: 'u1301', state: 'OPEN', title: 'open one', createdAt: '2026-07-20T00:00:00Z' }
  const since = '2026-07-26T21:17:39.507Z'

  // The predecessor's merged PR is not this run's, however recently gh lists it.
  assert.equal(pickRunPr([stale], since), undefined)
  // The run's own PR still counts after it merges, and the oldest post-start entry is the one
  // this run opened.
  assert.equal(pickRunPr([later, own, stale], since)?.number, 1249)
  // An open PR on the branch is where pushed commits land, whatever its age.
  assert.equal(pickRunPr([stale, open], since)?.number, 1301)
  // Without a start time only an open PR is trusted.
  assert.equal(pickRunPr([stale, own, later]), undefined)
  assert.equal(pickRunPr([stale, open])?.number, 1301)
})

test('a gone branch still reports its PR: it is a remote question (#1255)', async () => {
  const { git } = fakeGit({ ...REPO, 'rev-parse --verify --quiet refs/heads/the-framework/run-r1': '', remote: 'origin\n' })
  const handoff = await readRunHandoff('/repo', 'the-framework/run-r1', {
    git,
    pr: async () => ({ number: 1254, url: 'u1254', state: 'MERGED', title: 'web run', createdAt: '2026-07-26T21:52:58Z' }),
  })
  assert.equal(handoff?.exists, false)
  assert.equal(handoff?.pr?.number, 1254)
})

test('resolveRunPr finds a web run through its run-id branch when the session-name branch is a reused pin (#1251)', async () => {
  const asked: string[] = []
  const stale = { number: 1177, url: 'u1177', state: 'MERGED', title: 'old triage', createdAt: '2026-07-25T16:55:18Z' }
  const own = { number: 1249, url: 'u1249', state: 'OPEN', title: 'this triage', createdAt: '2026-07-26T21:35:13Z' }
  const prs = async (_cwd: string, branch: string) => {
    asked.push(branch)
    if (branch === 'the-framework/triage-quick') return { value: [stale], pending: false }
    if (branch === 'the-framework/run-2026-07-26T21-17-39-507Z') return { value: [own], pending: false }
    return { value: [], pending: false }
  }
  const found = await resolveRunPr('/repo', { id: '2026-07-26T21-17-39-507Z', sessionName: 'triage-quick' }, prs)
  assert.equal(found.value?.number, 1249)
  assert.deepEqual(asked, ['the-framework/triage-quick', 'the-framework/run-2026-07-26T21-17-39-507Z'])
})

test('resolveRunPr prefers the recorded branch and stops at the first hit', async () => {
  const asked: string[] = []
  const prs = async (_cwd: string, branch: string) => {
    asked.push(branch)
    return { value: [{ number: 5, url: 'u5', state: 'OPEN', title: 'mine' }], pending: false }
  }
  const found = await resolveRunPr('/repo', { id: 'r1', branch: 'feat/mine', sessionName: 'named' }, prs)
  assert.equal(found.value?.number, 5)
  assert.deepEqual(asked, ['feat/mine'])
})

test('resolveRunPr reports pending only while nothing was found and a lookup is still running', async () => {
  const prs = async (_cwd: string, branch: string) =>
    branch === 'the-framework/run-r1' ? { value: undefined, pending: true } : { value: [], pending: false }
  const found = await resolveRunPr('/repo', { id: 'r1', sessionName: 'named' }, prs)
  assert.equal(found.value, undefined)
  assert.equal(found.pending, true)
})

test('withheldMerge authorizes only a declared-done session with an empty session TODO (#1363)', () => {
  // The rule settled on #1390: config arms the merge, the agent authorizes it. No signal means
  // no merge, whatever else is true — this is what row 3 of the live matrix proved was missing
  // (the daemon merged 3s after the PR opened, with setReadyForMerge never called).
  assert.equal(withheldMerge({ readyForMerge: false, sessionTodoOpen: false }), 'not-ready-for-merge')
  assert.equal(withheldMerge({ readyForMerge: false, sessionTodoOpen: true }), 'not-ready-for-merge')
  // The temporary safety belt: the agent said done but its own session file says otherwise.
  assert.equal(withheldMerge({ readyForMerge: true, sessionTodoOpen: true }), 'session-todo-open')
  // Declared done, nothing pending in this session: the merge may run.
  assert.equal(withheldMerge({ readyForMerge: true, sessionTodoOpen: false }), undefined)
})
