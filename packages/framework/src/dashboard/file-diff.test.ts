import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileDiff, safeRepoPath } from './file-diff.js'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
].join('\n')

const fakeGit = (out: string) => async () => out

test('a modified file yields the hunks, without git’s diff/index preamble', async () => {
  const diff = await readFileDiff('/repo', 'src/a.ts', 'modified', fakeGit(PATCH))
  assert.ok(diff)
  assert.equal(diff.binary, false)
  assert.equal(diff.truncated, false)
  assert.ok(diff.patch.startsWith('--- a/src/a.ts'))
  assert.ok(!diff.patch.includes('diff --git'))
  assert.equal(diff.added, 2)
  assert.equal(diff.removed, 1) // the `---`/`+++` headers are not counted as changes
})

test('a file with no diff to show yields null, not an empty card', async () => {
  assert.equal(await readFileDiff('/repo', 'src/a.ts', 'modified', fakeGit('')), null)
})

test('a binary change says so rather than dumping bytes', async () => {
  const out = 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n'
  const diff = await readFileDiff('/repo', 'logo.png', 'modified', fakeGit(out))
  assert.ok(diff)
  assert.equal(diff.binary, true)
  assert.equal(diff.patch, '')
})

test('a long patch is cut and says it was cut', async () => {
  const body = ['--- a/big.ts', '+++ b/big.ts', '@@ -1 +1,600 @@', ...Array.from({ length: 600 }, (_, i) => `+line ${i}`)]
  const diff = await readFileDiff('/repo', 'big.ts', 'modified', fakeGit(body.join('\n')))
  assert.ok(diff)
  assert.equal(diff.truncated, true)
  assert.equal(diff.patch.split('\n').length, 500)
})

test('a repo with no commits falls back to the working-tree diff', async () => {
  // `git diff HEAD` fails before the first commit; the change is still worth showing.
  let calls = 0
  const git = async (args: string[]) => {
    calls++
    if (args.includes('HEAD')) throw new Error("fatal: ambiguous argument 'HEAD'")
    return PATCH
  }
  const diff = await readFileDiff('/repo', 'src/a.ts', 'modified', git)
  assert.ok(diff)
  assert.equal(calls, 2)
})

test('an untracked file renders as all-added from its contents, and git is never asked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-diff-'))
  await writeFile(join(dir, 'new.ts'), 'const a = 1\nconst b = 2\n')
  const git = async () => {
    throw new Error('git should not run for an untracked file')
  }
  const diff = await readFileDiff(dir, 'new.ts', 'untracked', git)
  assert.ok(diff)
  assert.equal(diff.patch, '+const a = 1\n+const b = 2')
  assert.equal(diff.added, 2)
  assert.equal(diff.removed, 0)
})

test('safeRepoPath rejects everything that is not a plain repo-relative path', () => {
  assert.equal(safeRepoPath('src/a.ts'), true)
  assert.equal(safeRepoPath('a.ts'), true)
  for (const bad of [
    '',
    '../outside.ts',
    'src/../../outside.ts',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '--output=/tmp/pwned', // git would read a leading dash as a flag
    '.git/config',
    '.git\\config',
    'src//a.ts',
    'a\0b',
  ]) {
    assert.equal(safeRepoPath(bad), false, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('an unsafe path is refused before any read', async () => {
  const git = async () => {
    throw new Error('git should not run for an unsafe path')
  }
  assert.equal(await readFileDiff('/repo', '../../etc/passwd', 'modified', git), null)
})
