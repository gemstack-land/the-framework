import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readRunHandoff, runBranchFor, pushRunBranch, openRunPullRequest, gitReason, runAutoHandoff, isSessionBranch } from './run-handoff.js'
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
