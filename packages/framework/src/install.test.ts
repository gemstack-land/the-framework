import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { enumerateGitRepos, installProject, type DirLister } from './install.js'
import { logsPath, readLogs, LOGS_HEADER, gitignorePath, LOGS_GITIGNORE } from './logs.js'
import type { GitRunner } from './project.js'
import type { StoreFs } from './store/index.js'

/** An in-memory {@link StoreFs} so the install logic is tested without touching disk. */
function memFs(seed: Record<string, string> = {}): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    async read(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      files.set(path, contents)
    },
    async append(path, contents) {
      files.set(path, (files.get(path) ?? '') + contents)
    },
    async exists(path) {
      return files.has(path)
    },
    async mkdir() {
      // no-op: the memory fs has no directories
    },
    async readdir(dir) {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = new Set<string>()
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) names.add(rest)
      }
      return [...names]
    },
  }
}

/** A scriptable {@link GitRunner} that records every call's args. */
function fakeGit(script: (args: string[], cwd: string) => Promise<string> | string) {
  const calls: string[][] = []
  const git: GitRunner = async (args, cwd) => {
    calls.push(args)
    return script(args, cwd)
  }
  return { git, calls }
}

const CWD = '/proj'

test('installProject on a clean repo seeds the log and makes exactly one install commit', async () => {
  const fs = memFs()
  const { git, calls } = fakeGit(args => (args[0] === 'rev-parse' ? 'true' : ''))

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true })
  assert.equal(fs.files.get(logsPath(CWD)), LOGS_HEADER)

  const commits = calls.filter(args => args[0] === 'commit')
  assert.deepEqual(commits, [['commit', '-m', '[The Framework] install The Framework']])
})

test('installProject seeds .the-framework/.gitignore so only LOGS.md is committed (#313)', async () => {
  const fs = memFs()
  const { git } = fakeGit(args => (args[0] === 'rev-parse' ? 'true' : ''))

  await installProject(CWD, { git, fs })
  assert.equal(fs.files.get(gitignorePath(CWD)), LOGS_GITIGNORE)
  // The ignore keeps run state (events.jsonl / run.json / runs/) untracked while committing LOGS.md.
  assert.match(LOGS_GITIGNORE, /^\*$/m)
  assert.match(LOGS_GITIGNORE, /^!LOGS\.md$/m)
})

test('installProject on a dirty repo commits the pre-existing changes first', async () => {
  const fs = memFs()
  const { git, calls } = fakeGit(args => {
    if (args[0] === 'rev-parse') return 'true'
    return args[0] === 'status' ? ' M file.ts\n' : ''
  })

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true })

  const commits = calls.filter(args => args[0] === 'commit').map(args => args[2])
  assert.deepEqual(commits, ['[The Framework] uncommitted changes', '[The Framework] install The Framework'])
})

test('installProject on an already-activated repo is a no-op that never calls git', async () => {
  const fs = memFs({ [logsPath(CWD)]: LOGS_HEADER })
  const { git, calls } = fakeGit(() => '')

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true, alreadyActivated: true })
  assert.deepEqual(calls, [])
})

test('installProject surfaces a git failure as { ok: false }, never throws', async () => {
  const fs = memFs()
  const { git } = fakeGit(args => {
    if (args[0] === 'rev-parse') return 'true'
    if (args[0] === 'commit') throw new Error('nothing to commit')
    return ''
  })

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: false, error: 'nothing to commit' })
})

test('installProject initializes a git repo when the folder is not one yet, then installs', async () => {
  const fs = memFs()
  // rev-parse fails on a non-repo folder; every other git call succeeds.
  const { git, calls } = fakeGit(args => {
    if (args[0] === 'rev-parse') throw new Error('not a git repository')
    return ''
  })

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true, initialized: true })
  assert.ok(calls.some(args => args[0] === 'init'), 'ran git init')
  const commits = calls.filter(args => args[0] === 'commit').map(args => args[2])
  assert.deepEqual(commits, ['[The Framework] install The Framework'])
})

test('the seeded LOGS.md is a valid empty log', async () => {
  const fs = memFs()
  const { git } = fakeGit(args => (args[0] === 'rev-parse' ? 'true' : ''))

  await installProject(CWD, { git, fs })
  assert.equal(fs.files.get(logsPath(CWD)), LOGS_HEADER)
  assert.deepEqual(await readLogs(CWD, fs), [])
})

test('enumerateGitRepos keeps only children that are their own repo roots, sorted', async () => {
  const dir = '/repos'
  const children = [join(dir, 'b'), join(dir, 'a'), join(dir, 'nested'), join(dir, 'plain')]
  const dirs: DirLister = { childDirs: async () => children }
  // `git rev-parse --show-prefix`: '' at a repo root, a path inside an outer repo,
  // and an error when the dir is not a repo at all.
  const { git } = fakeGit((_args, cwd) => {
    if (cwd === join(dir, 'nested')) return 'nested/\n' // subdir of an outer repo
    if (cwd === join(dir, 'plain')) throw new Error('not a git repository')
    return '\n'
  })

  assert.deepEqual(await enumerateGitRepos(dir, { git, dirs }), [join(dir, 'a'), join(dir, 'b')])
})

test('enumerateGitRepos on an empty or missing dir is []', async () => {
  const dirs: DirLister = { childDirs: async () => [] }
  const { git, calls } = fakeGit(() => '')

  assert.deepEqual(await enumerateGitRepos('/nowhere', { git, dirs }), [])
  assert.deepEqual(calls, [])
})
