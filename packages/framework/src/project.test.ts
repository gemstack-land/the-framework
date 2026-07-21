import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { THE_FRAMEWORK_DIR } from './logs.js'
import {
  crawlRepoFiles,
  gitTimeoutMs,
  isActivated,
  theFrameworkDir,
  GIT_READ_TIMEOUT_MS,
  GIT_SLOW_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
  type GitRunner,
  type ProjectFs,
} from './project.js'

const CWD = '/proj'

/** A {@link ProjectFs} that reports exactly one set of paths as directories. */
function fakeFs(dirs: string[]): ProjectFs {
  return {
    async isDirectory(path) {
      return dirs.includes(path)
    },
  }
}

test('theFrameworkDir joins cwd + .the-framework', () => {
  assert.equal(theFrameworkDir(CWD), join(CWD, THE_FRAMEWORK_DIR))
})

test('isActivated is true when .the-framework/ is a directory', async () => {
  assert.equal(await isActivated(CWD, fakeFs([join(CWD, THE_FRAMEWORK_DIR)])), true)
})

test('isActivated is false when the marker dir is absent', async () => {
  assert.equal(await isActivated(CWD, fakeFs([])), false)
})

test('crawlRepoFiles parses NUL-separated output, deduped + sorted', async () => {
  const calls: { args: string[]; cwd: string }[] = []
  const run: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    // git -z output ends with a trailing NUL.
    return 'src/b.ts\0README.md\0src/a.ts\0'
  }
  const files = await crawlRepoFiles(CWD, run)
  assert.deepEqual(files, ['README.md', 'src/a.ts', 'src/b.ts'])
  assert.deepEqual(calls, [
    { args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd: CWD },
  ])
})

test('crawlRepoFiles drops the trailing empty entry from the final NUL', async () => {
  const files = await crawlRepoFiles(CWD, async () => 'only.ts\0')
  assert.deepEqual(files, ['only.ts'])
})

test('crawlRepoFiles de-dupes a path that appears twice', async () => {
  const files = await crawlRepoFiles(CWD, async () => 'dup.ts\0dup.ts\0other.ts\0')
  assert.deepEqual(files, ['dup.ts', 'other.ts'])
})

test('crawlRepoFiles yields [] when git fails', async () => {
  const files = await crawlRepoFiles(CWD, async () => {
    throw new Error('not a git repository')
  })
  assert.deepEqual(files, [])
})

/**
 * Every git invocation in the package, taken from the call sites listed in #997, against the
 * budget it should get. The point of the split is that these are not all the same number.
 */
const BUDGETS: { args: string[]; ms: number }[] = [
  // The network and a whole checkout: the two the flat 10s budget was killing.
  { args: ['push', '--set-upstream', 'origin', 'the-framework/run-1'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['worktree', 'add', '-b', 'the-framework/run-1', '/wt', 'main'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['worktree', 'add', '/wt', 'the-framework/run-1'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['clone', 'https://example.com/repo.git', '/dest'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['fetch', 'origin'], ms: GIT_SLOW_TIMEOUT_MS },
  // Local mutations.
  { args: ['add', '-A'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['commit', '-m', 'msg', '--', 'path'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['init'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['checkout', 'branch', '--', 'TODO.md'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['worktree', 'remove', '--force', '/wt'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['worktree', 'prune'], ms: GIT_WRITE_TIMEOUT_MS },
  // Reads, which must stay short so a hung one does not hold the daemon for minutes.
  { args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['status', '--porcelain'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['rev-parse', '--abbrev-ref', 'HEAD'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['rev-parse', '--git-common-dir'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['rev-list', '--count', 'a..b'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['log', '--format=%H%x1f%s', 'a..b'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['diff', '--numstat', 'HEAD'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['show', 'HEAD:TODO.md'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['remote', 'get-url', 'origin'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['branch', '--list', '--merged', 'main', 'topic'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['worktree', 'list', '--porcelain'], ms: GIT_READ_TIMEOUT_MS },
]

for (const { args, ms } of BUDGETS) {
  test(`gitTimeoutMs: \`git ${args.join(' ')}\` gets ${ms}ms (#997)`, () => {
    assert.equal(gitTimeoutMs(args), ms)
  })
}

test('the git budgets stay split rather than collapsing to one number (#997)', () => {
  // Pinned on purpose: widening reads to "fix" a slow op would let a hung read hold the daemon.
  assert.equal(GIT_READ_TIMEOUT_MS, 10_000)
  assert.equal(GIT_WRITE_TIMEOUT_MS, 30_000)
  assert.equal(GIT_SLOW_TIMEOUT_MS, 120_000)
})

test('gitTimeoutMs: a slow op gets far longer than a read (#997)', () => {
  assert.ok(
    gitTimeoutMs(['push', '--set-upstream', 'origin', 'b']) > gitTimeoutMs(['rev-parse', 'HEAD']) * 2,
    'push must not run under a read budget',
  )
  assert.ok(
    gitTimeoutMs(['worktree', 'add', '-b', 'b', '/wt']) > gitTimeoutMs(['worktree', 'list']) * 2,
    'worktree add must not run under the budget its read sibling gets',
  )
})

test('gitTimeoutMs: an unknown subcommand is treated as a mutation, not as slow (#997)', () => {
  assert.equal(gitTimeoutMs(['bisect', 'start']), GIT_WRITE_TIMEOUT_MS)
  assert.equal(gitTimeoutMs([]), GIT_WRITE_TIMEOUT_MS)
})

test('gitTimeoutMs: leading flags do not hide the subcommand (#997)', () => {
  assert.equal(gitTimeoutMs(['--no-pager', 'status', '--porcelain']), GIT_READ_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--no-pager', 'push', 'origin', 'b']), GIT_SLOW_TIMEOUT_MS)
})

test('gitTimeoutMs: the value of a global option is not mistaken for the subcommand', () => {
  assert.equal(gitTimeoutMs(['-C', '/repo', 'push', 'origin', 'b']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-C', '/repo', 'status', '--porcelain']), GIT_READ_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-C', '/repo', 'commit', '-m', 'msg']), GIT_WRITE_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-c', 'user.name=x', 'fetch', 'origin']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--git-dir', '/repo/.git', 'clone', 'url', '/dest']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--work-tree', '/repo', 'pull']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--namespace', 'ns', 'log']), GIT_READ_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--exec-path', '/libexec', 'push']), GIT_SLOW_TIMEOUT_MS)
})

test('gitTimeoutMs: a global option before `worktree` does not hide `add`', () => {
  assert.equal(gitTimeoutMs(['-C', '/repo', 'worktree', 'add', '-b', 'b', '/wt']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-C', '/repo', 'worktree', 'list', '--porcelain']), GIT_READ_TIMEOUT_MS)
})

test('gitTimeoutMs: an inline `--opt=value` global option carries its own value', () => {
  assert.equal(gitTimeoutMs(['--git-dir=/repo/.git', 'push', 'origin', 'b']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--git-dir=/repo/.git', 'status']), GIT_READ_TIMEOUT_MS)
})
