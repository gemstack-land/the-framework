import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { sendStop, sendMessage, sendChoice } from './control.telefunc.js'
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
