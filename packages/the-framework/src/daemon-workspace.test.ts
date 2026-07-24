import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectRuntime, cleanupTimedOutWorktree, tearDownTopicScratch, moveTopicRunHistory } from './daemon-runtime.js'
import { CliTimeoutError } from './cli-exec.js'
import { FRAMEWORK_DIR, WORKTREES_DIR, EVENTS_FILE, META_FILE, worktreePath, runBranchName, RUN_META_VERSION, type RunMeta } from './store/index.js'
import { topicScratchPath, addProject, projectId } from './registry.js'
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

/** A committed git repo to re-home a run into, path realpath'd so it matches what git reports. */
async function initRepo(prefix: string): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  const git = nodeGitRunner()
  await git(['init'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-m', 'init'], repo)
  return repo
}

/**
 * A stub CLI that records its argv, then (for a topic run only) stays alive until the daemon
 * terminates it on re-home (a real topic run parks in the chat loop the same way). The continued
 * `prompt` run exits at once, so it never lingers past the test.
 */
async function writeTopicStub(dir: string, log: string): Promise<string> {
  const stub = join(dir, 'topic-stub.cjs')
  await writeFile(
    stub,
    `const fs = require('node:fs')\n` +
      `const argv = process.argv.slice(2)\n` +
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n')\n` +
      `if (argv.includes('--topic')) {\n` +
      `  const t = setInterval(() => {}, 1000)\n` +
      `  process.on('SIGTERM', () => { clearInterval(t); process.exit(0) })\n` +
      `}\n`,
  )
  return stub
}

/** Write a topic run's scratch state (as its own process would), then record the bind that fires re-home. */
async function seedBoundTopicRun(scratch: string, runId: string, projectId: string, sessionId: string): Promise<void> {
  const dir = join(scratch, FRAMEWORK_DIR)
  await mkdir(dir, { recursive: true })
  const meta: RunMeta = {
    version: RUN_META_VERSION,
    status: 'running',
    id: runId,
    startedAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    passes: 0,
    topic: true,
    sessionId,
  }
  await writeFile(join(dir, META_FILE), JSON.stringify(meta))
  // The bind the run recorded (#1121): the event the daemon tails for and re-homes on (#1122).
  await writeFile(join(dir, EVENTS_FILE), JSON.stringify({ kind: 'bind', projectId }) + '\n')
}

/** Poll the stub's recorded starts until at least `expected` land, or time out. */
async function waitForArgs(log: string, expected: number): Promise<string[][]> {
  let lines: string[] = []
  for (let i = 0; i < 300 && lines.length < expected; i++) {
    await new Promise(r => setTimeout(r, 20))
    lines = await readFile(log, 'utf8').then(s => s.split('\n').filter(Boolean), () => [])
  }
  return lines.map(line => JSON.parse(line) as string[])
}

test('binding a topic run re-homes it into the bound project: a worktree there, its session resumed, the scratch gone (#1122)', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'framework-rehome-home-')))
  const config = await realpath(await mkdtemp(join(tmpdir(), 'framework-rehome-cfg-')))
  const target = await initRepo('framework-rehome-target-')
  const env = { XDG_CONFIG_HOME: config }
  const runtime = createProjectRuntime({ cwd: home, env, binPath: await writeTopicStub(home, join(home, 'started.log')) })
  try {
    // The DIFFERENT, newly chosen project the run will move into: the #1122 delta over continue-run,
    // which only ever re-homed a run into the project it already belonged to.
    const record = await addProject(target, new Date().toISOString(), undefined, env)
    const boundId = projectId(target)
    assert.equal(record.id, boundId)

    const started = (await runtime.onStart('draft a plan', 'build', { topic: true })) as { ok: boolean; runId?: string }
    assert.equal(started.ok, true)
    const runId = started.runId!
    const scratch = topicScratchPath(env, runId)

    // The run gets a session, then binds: exactly the state a real topic run reaches at its gate.
    await seedBoundTopicRun(scratch, runId, boundId, 'sess-xyz')

    const starts = await waitForArgs(join(home, 'started.log'), 2)
    assert.equal(starts.length, 2, 'the scratch run started, then the daemon spawned the continued run')
    const cont = starts[1]!
    const worktree = worktreePath(target, runId)
    assert.equal(cont[0], 'prompt', 'the run continues as a prompt run carrying the move note')
    assert.equal(cont[cont.indexOf('--cwd') + 1], worktree, 'in a worktree under the BOUND project, not the scratch')
    assert.equal(cont[cont.indexOf('--run-id') + 1], runId, 'reusing the topic run id, so it stays one run')
    assert.equal(cont.includes('--continue-run'), true, 'reopening the moved run rather than starting fresh')
    assert.equal(cont[cont.indexOf('--resume-session') + 1], 'sess-xyz', 'resuming the SAME agent session')
    assert.equal(cont.includes('--topic'), false, 'it is an ordinary project run now')

    // The re-home is structural: the run lives in a real worktree + branch under the target project.
    assert.equal(await stat(worktree).then(s => s.isDirectory(), () => false), true, 'the worktree exists')
    const branches = await nodeGitRunner()(['branch', '--list', runBranchName(runId)], target)
    assert.match(branches, new RegExp(runBranchName(runId).replace('/', '\\/')), 'on its run branch')

    // Its history moved with it, marked as a project run bound to the target.
    const moved = JSON.parse(await readFile(join(worktree, FRAMEWORK_DIR, META_FILE), 'utf8')) as RunMeta
    assert.equal(moved.id, runId)
    assert.equal(moved.boundProjectId, boundId, 'the run records the project it bound to')
    assert.equal(moved.topic, undefined, 'and no longer reads as a project-less topic run')

    // The scratch it left is gone (not merely retained): the conversation moved on, it did not die there.
    assert.equal(await stat(scratch).then(() => true, () => false), false, 'the scratch dir is removed')
  } finally {
    await runtime.suspendRuns().catch(() => {})
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
    await rm(config, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})

test('a bind to an unresolvable project retains the scratch and surfaces the failure, spawning nothing (#1122)', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'framework-rehome-fail-home-')))
  const config = await realpath(await mkdtemp(join(tmpdir(), 'framework-rehome-fail-cfg-')))
  const env = { XDG_CONFIG_HOME: config }
  const log = join(home, 'started.log')
  const runtime = createProjectRuntime({ cwd: home, env, binPath: await writeTopicStub(home, log) })
  try {
    const started = (await runtime.onStart('draft a plan', 'build', { topic: true })) as { ok: boolean; runId?: string }
    const runId = started.runId!
    const scratch = topicScratchPath(env, runId)

    // Bind to a project id that was never registered: nothing to re-home into.
    await seedBoundTopicRun(scratch, runId, 'ghost-project-000', 'sess-xyz')

    // Wait for the daemon to see the bind and log its failure, rather than a second spawn.
    let events = ''
    for (let i = 0; i < 300 && !events.includes('could not re-home'); i++) {
      await new Promise(r => setTimeout(r, 20))
      events = await readFile(join(scratch, FRAMEWORK_DIR, EVENTS_FILE), 'utf8').catch(() => '')
    }
    assert.match(events, /could not re-home this run: unknown project ghost-project-000/, 'the failure is surfaced as an event')
    // The topic run itself started; the re-home did not spawn anything on top of it.
    const starts = await waitForArgs(log, 1)
    assert.equal(starts.length, 1, 'only the topic run spawned; no continued run')
    assert.equal(starts[0]!.includes('--topic'), true, 'and that one start is the topic run')
    assert.equal(await stat(scratch).then(() => true, () => false), true, 'the scratch is retained so the conversation is not lost')
  } finally {
    await runtime.suspendRuns().catch(() => {})
    await runtime.dispose()
    await rm(home, { recursive: true, force: true })
    await rm(config, { recursive: true, force: true })
  }
})

test('moveTopicRunHistory copies the log and re-marks the meta as a bound project run (#1122)', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'framework-movehist-')))
  try {
    const scratch = join(base, 'scratch')
    const worktree = join(base, 'worktree')
    const dir = join(scratch, FRAMEWORK_DIR)
    await mkdir(dir, { recursive: true })
    const meta: RunMeta = {
      version: RUN_META_VERSION,
      status: 'running',
      id: 'run1',
      startedAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
      passes: 0,
      topic: true,
      sessionId: 'sess-1',
      intent: 'draft a plan',
    }
    await writeFile(join(dir, META_FILE), JSON.stringify(meta))
    await writeFile(join(dir, EVENTS_FILE), JSON.stringify({ kind: 'log', message: 'hello' }) + '\n')

    await moveTopicRunHistory(scratch, worktree, 'proj-abc')

    const moved = JSON.parse(await readFile(join(worktree, FRAMEWORK_DIR, META_FILE), 'utf8')) as RunMeta
    assert.equal(moved.topic, undefined, 'the topic flag is cleared')
    assert.equal(moved.boundProjectId, 'proj-abc', 'the bound project is recorded')
    assert.equal(moved.id, 'run1', 'the run id and its history are preserved')
    assert.equal(moved.intent, 'draft a plan')
    assert.match(await readFile(join(worktree, FRAMEWORK_DIR, EVENTS_FILE), 'utf8'), /hello/, 'the event log came along')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
