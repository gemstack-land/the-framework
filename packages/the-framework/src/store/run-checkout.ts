import { isSafeRunId, readLiveMetas } from './run-store.js'
import { worktreePath } from './worktree.js'
import { nodeFs } from '../node-fs.js'

/**
 * The checkout a run id resolves to (#738/#797): the run's own worktree while it exists, else
 * the project root. Live metas first — a running run records its cwd — then the worktree
 * directory itself, which exists before the run has written its `run.json` (#766): the daemon
 * creates the directory and spawns the process, and only then does the run write its meta, so
 * a lookup by run state alone misses a run that certainly exists.
 *
 * The directory probe matters beyond a slow first read: a Telefunc Channel resolves its path
 * once, when the client subscribes. Falling back to the project root would not self-correct a
 * moment later — the channel would tail the wrong file for the life of the subscription, which
 * is how a newly started run once showed a previous run's output.
 *
 * An unknown or finished `runId` falls back to the project root rather than failing: the
 * run's worktree may already be gone, and the project's own state is still the sane thing to
 * act on. This is the one resolution every run-addressed surface shares — the daemon's serve
 * targets and previews, and each dashboard RPC — so the fallback rules cannot drift apart.
 */
export async function resolveRunCheckout(projectCwd: string, runId: string | undefined): Promise<string> {
  if (!runId || !isSafeRunId(runId)) return projectCwd
  const live = await readLiveMetas(projectCwd).catch(() => [])
  const running = live.find(run => run.id === runId)?.cwd
  if (running) return running
  const path = worktreePath(projectCwd, runId)
  return (await nodeFs().isDirectory(path)) ? path : projectCwd
}
