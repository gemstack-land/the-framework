import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { THE_FRAMEWORK_DIR } from './logs.js'
import {
  crawlRepoFiles,
  isActivated,
  theFrameworkDir,
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
