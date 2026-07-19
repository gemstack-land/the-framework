import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { sendStop, sendMessage, sendChoice, sendRemoveWorktree } from './control.telefunc.js'
import { onRetainedWorktrees, onRuns } from './reads.telefunc.js'
import { addProject, projectId as idFor } from '../registry.js'
import { FRAMEWORK_DIR, WORKTREES_DIR } from '../store/index.js'
import { CONTROL_FILE } from '../control.js'

// #749: a run tails the control log inside its own worktree (#736), so a steering call has to
// resolve the RUN, not the project. Addressed at the project root, Stop / messages / choice picks
// reach a file the run is not watching, which is why they silently did nothing.
//
// These run against the real registry, pointed at a temp $XDG_CONFIG_HOME so the user's own
// registry is never touched.

/** A project with one live run in a worktree. Returns its ids and the two candidate log paths. */
async function projectWithWorktreeRun(): Promise<{
  dir: string
  projectId: string
  runId: string
  runControl: string
  rootControl: string
  restore: () => void
}> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'framework-addressing-')))
  const runId = '2026-07-19T10-00-00-000Z'
  const worktree = join(dir, FRAMEWORK_DIR, WORKTREES_DIR, runId)
  await mkdir(join(worktree, FRAMEWORK_DIR), { recursive: true })
  // The live meta is what readLiveMetas discovers, and its id is what the caller addresses.
  await writeFile(
    join(worktree, FRAMEWORK_DIR, 'run.json'),
    JSON.stringify({ version: 1, status: 'running', id: runId, startedAt: runId, updatedAt: runId, passes: 0 }),
  )

  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  await addProject(dir, new Date().toISOString())

  return {
    dir,
    projectId: idFor(dir),
    runId,
    runControl: join(worktree, FRAMEWORK_DIR, CONTROL_FILE),
    rootControl: join(dir, FRAMEWORK_DIR, CONTROL_FILE),
    restore: () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
    },
  }
}

const entries = async (path: string): Promise<unknown[]> =>
  (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)

test('sendStop with a run id writes to that run worktree control log, not the project root (#749)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    await sendStop(ctx.projectId, ctx.runId)
    assert.deepEqual(await entries(ctx.runControl), [{ kind: 'stop' }], 'the run gets the stop it is tailing for')
    assert.deepEqual(await entries(ctx.rootControl), [], 'and nothing is written where nothing is listening')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('sendMessage and sendChoice address the run too (#749)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    await sendMessage(ctx.projectId, 'also add tests', ctx.runId)
    await sendChoice(ctx.projectId, 'gate-1', 'option-b', 'user', ctx.runId)
    assert.deepEqual(await entries(ctx.runControl), [
      { kind: 'message', text: 'also add tests' },
      { kind: 'choice', id: 'gate-1', pick: 'option-b', by: 'user' },
    ])
    assert.deepEqual(await entries(ctx.rootControl), [])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('an unknown or absent run id falls back to the project root, as before #736 (#749)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    // No run id at all: the pre-#736 addressing, still right for a run with no worktree.
    await sendStop(ctx.projectId)
    // A run that has since finished and had its worktree removed must not throw or vanish.
    await sendStop(ctx.projectId, 'a-run-that-is-gone')
    assert.deepEqual(await entries(ctx.rootControl), [{ kind: 'stop' }, { kind: 'stop' }])
    assert.deepEqual(await entries(ctx.runControl), [], 'the live run is left alone')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #737: a failed run keeps its worktree for inspection, so removing one is an explicit action —
// and must never yank the checkout out from under a run that is still going.

test('sendRemoveWorktree refuses while that run is still live (#737)', async () => {
  const ctx = await projectWithWorktreeRun() // its run.json says `running`
  try {
    const result = await sendRemoveWorktree(ctx.projectId, ctx.runId)
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /still going/)
    assert.equal(await entries(ctx.runControl).then(() => true), true, 'the worktree is untouched')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('sendRemoveWorktree rejects an unsafe run id before touching anything (#737)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    const result = await sendRemoveWorktree(ctx.projectId, '../../etc')
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /invalid session id/)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('onRetainedWorktrees hides a live run, and lists one that has finished (#737)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    assert.deepEqual(await onRetainedWorktrees(ctx.projectId), [], 'a running run has nothing to offer removing')
    // Once it is no longer running, its retained checkout is listed.
    await writeFile(
      join(ctx.dir, FRAMEWORK_DIR, WORKTREES_DIR, ctx.runId, FRAMEWORK_DIR, 'run.json'),
      JSON.stringify({ version: 1, status: 'failed', id: ctx.runId, startedAt: ctx.runId, updatedAt: ctx.runId, passes: 0 }),
    )
    assert.deepEqual(await onRetainedWorktrees(ctx.projectId), [ctx.runId])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #766: for the first seconds of a run there is a worktree but no `run.json` yet. Resolving by run
// state misses it and falls back to the project root, and because a Telefunc Channel resolves its
// path once at subscribe time, the feed then tails the root's log — a previous run's output — for
// the life of the subscription. Resolve by the directory, which the daemon creates before it spawns.
test('a run that has a worktree but has not written its state yet still resolves to it (#766)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    const fresh = '2026-07-19T11-30-00-000Z'
    const worktree = join(ctx.dir, FRAMEWORK_DIR, WORKTREES_DIR, fresh)
    await mkdir(worktree, { recursive: true }) // the daemon has made the checkout; the run has not started writing
    await sendStop(ctx.projectId, fresh)
    assert.deepEqual(
      await entries(join(worktree, FRAMEWORK_DIR, CONTROL_FILE)),
      [{ kind: 'stop' }],
      'addressed at the run whose worktree exists, not the project root',
    )
    assert.deepEqual(await entries(ctx.rootControl), [], 'the project root is left alone')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a run id with no worktree at all still falls back to the project root (#766)', async () => {
  const ctx = await projectWithWorktreeRun()
  try {
    // The non-git fallback path, and any run whose worktree has since been removed.
    await sendStop(ctx.projectId, '2026-07-19T11-45-00-000Z')
    assert.deepEqual(await entries(ctx.rootControl), [{ kind: 'stop' }])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #768: a continued run (#762) has an archived copy from its first leg AND is live again. The
// dedup used to keep the archive and drop the live copy, so the dashboard showed a running run as
// finished — the run really was going, the UI just rendered its stale replay and looked dead.
test('a continued run reads as running, not as its archived first leg (#768)', async () => {
  const ctx = await projectWithWorktreeRun() // its worktree meta says `running`
  try {
    // Its first leg was archived when it finished, exactly as teardown (#737) leaves things.
    await mkdir(join(ctx.dir, FRAMEWORK_DIR, 'runs'), { recursive: true })
    await writeFile(
      join(ctx.dir, FRAMEWORK_DIR, 'runs', `${ctx.runId}.json`),
      JSON.stringify({ version: 1, status: 'done', id: ctx.runId, startedAt: ctx.runId, updatedAt: ctx.runId, passes: 1 }),
    )
    const runs = (await onRuns(ctx.projectId)) as { id: string; status: string }[]
    const mine = runs.filter(run => run.id === ctx.runId)
    assert.equal(mine.length, 1, 'still one row, not two')
    assert.equal(mine[0]?.status, 'running', 'and it reads as live, not as the archived first leg')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
