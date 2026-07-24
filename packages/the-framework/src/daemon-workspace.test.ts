import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectRuntime, cleanupTimedOutWorktree, tearDownTopicScratch } from './daemon-runtime.js'
import { CliTimeoutError } from './cli-exec.js'
import { FRAMEWORK_DIR, WORKTREES_DIR, worktreePath, RUN_META_VERSION, type RunMeta } from './store/index.js'
import { topicScratchPath } from './registry.js'
import { nodeGitRunner } from './project.js'

/**
 * Where a run is allowed to land (#997). A run gets its own worktree (#736); the pre-#736
 * fallback into the project's own checkout survives only for a project that cannot host one at
 * all. A repo whose `worktree add` failed used to take that same fallback, which pointed the
 * agent at the user's working tree and its uncommitted work.
 */

/** A stub CLI that records the argv it was spawned with, so a start is observable. */
async function writeStub(dir: string, log: string): Promise<string> {
  const stub = join(dir, 'stub-cli.cjs')
  await writeFile(
    stub,
    `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`,
  )
  return stub
}

/** The stub's recorded starts, waited for (a start spawns detached). */
async function startedArgs(log: string, expected: number): Promise<string[][]> {
  let lines: string[] = []
  for (let i = 0; i < 100 && lines.length < expected; i++) {
    await new Promise(r => setTimeout(r, 20))
    lines = await readFile(log, 'utf8').then(s => s.split('\n').filter(Boolean), () => [])
  }
  return lines.map(line => JSON.parse(line) as string[])
}

/** Capture `console.log` for the duration of `body`. */
async function withCapturedLog(body: () => Promise<void>): Promise<string> {
  const original = console.log
  const lines: string[] = []
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
  try {
    await body()
  } finally {
    console.log = original
  }
  return lines.join('\n')
}

test('a repo whose worktree could not be created fails the run instead of borrowing the checkout (#997)', async () => {
  // realpath: on macOS tmpdir sits under the /var -> /private/var symlink and git reports the
  // resolved path (the same gotcha the worktree round-trip test documents).
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'framework-alloc-fail-')))
  try {
    const git = nodeGitRunner()
    await git(['init'], cwd)
    await git(['config', 'user.email', 't@t'], cwd)
    await git(['config', 'user.name', 't'], cwd)
    await writeFile(join(cwd, 'README.md'), '# t\n')
    await git(['add', '-A'], cwd)
    await git(['commit', '-m', 'init'], cwd)

    // A *file* where the worktrees directory belongs: git cannot create the leading directories,
    // so `worktree add` rejects. Stands in for the SIGTERM this exists for, which needs a repo big
    // enough to outrun a 120s budget; both arrive here as one rejection from a working git.
    await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
    await writeFile(join(cwd, FRAMEWORK_DIR, WORKTREES_DIR), '')

    const log = join(cwd, 'started.log')
    const runtime = createProjectRuntime({ cwd, env: {}, binPath: await writeStub(cwd, log) })
    const result = await runtime.onStart('build a thing', 'build')

    assert.equal(result.ok, false, 'the Start is refused rather than downgraded into the main checkout')
    assert.match(result.ok ? '' : result.error, /could not create a worktree for this run/)
    // The real damage the fallback did: an agent editing the user's own working tree.
    assert.deepEqual(await startedArgs(log, 1), [], 'no run was spawned at all')
    await runtime.dispose()
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a project that is not a git repo still falls back to the main checkout, and says why (#997)', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'framework-alloc-nogit-')))
  try {
    const log = join(cwd, 'started.log')
    const runtime = createProjectRuntime({ cwd, env: {}, binPath: await writeStub(cwd, log) })
    let result: { ok: boolean; runId?: string } | undefined
    const logged = await withCapturedLog(async () => {
      result = (await runtime.onStart('build a thing', 'build')) as { ok: boolean; runId?: string }
    })

    assert.equal(result?.ok, true, 'the pre-#736 fallback is intact for a project with no repo')
    assert.equal(result?.runId, undefined, 'and is still signalled by the absent runId')
    const args = await startedArgs(log, 1)
    assert.equal(args.length, 1, 'the run spawned')
    assert.equal(args[0]![args[0]!.indexOf('--cwd') + 1], cwd, 'in the main checkout')
    assert.equal(args[0]!.includes('--run-id'), false)
    // The message has to name the reason: "no worktree (<git error>)" read the same whether git
    // was absent or git had failed, which is exactly the distinction that went missing.
    assert.match(logged, /is not a git repository, so it gets no worktree/)
    await runtime.dispose()
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

/** Write a run's live meta into a checkout, so a teardown/read has a status to act on. */
async function writeRunMeta(checkout: string, status: RunMeta['status'], extra: Partial<RunMeta> = {}): Promise<void> {
  const dir = join(checkout, FRAMEWORK_DIR)
  await mkdir(dir, { recursive: true })
  const meta: RunMeta = {
    version: RUN_META_VERSION,
    status,
    id: 'run1',
    startedAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    passes: 0,
    ...extra,
  }
  await writeFile(join(dir, 'run.json'), JSON.stringify(meta))
}

test('a project-less topic run spawns in a neutral scratch dir with no worktree (#1120)', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'framework-topic-home-')))
  const config = await realpath(await mkdtemp(join(tmpdir(), 'framework-topic-cfg-')))
  try {
    const log = join(home, 'started.log')
    // XDG_CONFIG_HOME steers the scratch dir the same way it steers the registry file.
    const env = { XDG_CONFIG_HOME: config }
    const runtime = createProjectRuntime({ cwd: home, env, binPath: await writeStub(home, log) })
    const result = (await runtime.onStart('draft a ticket', 'build', { topic: true })) as { ok: boolean; runId?: string }

    assert.equal(result.ok, true, 'a topic run starts without a project')
    assert.ok(result.runId, 'and reports its allocated run id')
    const scratch = topicScratchPath(env, result.runId!)
    const args = (await startedArgs(log, 1))[0]!
    assert.equal(args[args.indexOf('--cwd') + 1], scratch, 'spawned into the config-home scratch dir')
    assert.equal(args[args.indexOf('--run-id') + 1], result.runId, 'with its allocated run id')
    assert.equal(args.includes('--topic'), true, 'flagged as a topic run so its meta records it')
    // The whole point: no repo, so no worktree anywhere near the home checkout.
    assert.equal(await stat(join(home, FRAMEWORK_DIR, WORKTREES_DIR)).then(() => true, () => false), false, 'no worktree allocated')
    assert.equal(await stat(scratch).then(s => s.isDirectory(), () => false), true, 'the scratch dir exists')
    await runtime.dispose()
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(config, { recursive: true, force: true })
  }
})

test('a topic scratch dir is removed on a clean finish and retained on failure or stop (#1120)', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'framework-topic-teardown-')))
  const exists = async (dir: string): Promise<boolean> => stat(dir).then(() => true, () => false)
  try {
    const done = join(base, 'done')
    await writeRunMeta(done, 'done')
    await tearDownTopicScratch(done)
    assert.equal(await exists(done), false, 'a run that finished cleanly loses its scratch dir')

    for (const status of ['failed', 'stopped'] as const) {
      const dir = join(base, status)
      await writeRunMeta(dir, status)
      await tearDownTopicScratch(dir)
      assert.equal(await exists(dir), true, `a ${status} run keeps its scratch dir for inspection`)
    }

    // An unreadable / still-running scratch is kept: only a proven clean finish is removed.
    const running = join(base, 'running')
    await writeRunMeta(running, 'running')
    await tearDownTopicScratch(running)
    assert.equal(await exists(running), true, 'a run still going keeps its scratch dir')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a SIGTERMed worktree add has its partial checkout removed, other failures do not (#997)', async () => {
  // Observed against real git: a SIGTERM mid-add leaves the directory it had written and git
  // drops its own administrative entry, so `worktree prune` has nothing to clean.
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'framework-alloc-partial-')))
  try {
    const partial = worktreePath(repo, 'run1')
    const exists = async (): Promise<boolean> => stat(partial).then(() => true, () => false)

    await mkdir(join(partial, 'src'), { recursive: true })
    await cleanupTimedOutWorktree(repo, 'run1', new Error('fatal: invalid reference: HEAD'))
    assert.equal(await exists(), true, 'a plain git rejection leaves the path alone')

    await cleanupTimedOutWorktree(repo, 'run1', new CliTimeoutError('git', ['worktree', 'add'], 120_000))
    assert.equal(await exists(), false, 'a timeout kill takes its half-written checkout with it')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
