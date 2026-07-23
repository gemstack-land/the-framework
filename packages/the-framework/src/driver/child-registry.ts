/**
 * Process-tree kill registry.
 *
 * The framework spawns the Claude Code CLI, which in turn spawns a deep subtree
 * (node workers, ripgrep, bash tool calls, MCP servers). Signaling only the
 * top-level `claude` orphans that subtree: it reparents to init and keeps
 * burning CPU — the runaway-process leak we hit (a swarm of stray `claude`
 * processes after a run was interrupted).
 *
 * Fix: spawn each long-lived child as its own process-group leader (`detached`)
 * and signal the whole group at once via a negative pid. Register every live
 * child here so a hard framework exit (crash, uncaught error, process.exit)
 * still reaps the trees on the way out.
 */

/** Live process-group leaders we spawned, by pid. Force-killed on our exit. */
const live = new Set<number>()
let exitHookInstalled = false

/**
 * Signal an entire process group. `pid` must be a group leader (spawned
 * `detached`); the negative pid targets the group, reaping the whole subtree in
 * one shot. Never throws — a group that already exited is not an error.
 */
export function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Group already gone, or pid never led one; nothing to do.
  }
}

/** Track a detached child so it is force-killed if the framework exits first. */
export function registerChild(pid: number): void {
  installExitHook()
  live.add(pid)
}

/** Stop tracking a child that has already exited (or been killed). */
export function unregisterChild(pid: number): void {
  live.delete(pid)
}

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  // `exit` fires on normal completion, process.exit(), and after an uncaught
  // error unwinds — sync-only, so a plain group SIGKILL is all we can (and need
  // to) do. Signal deaths (SIGINT/SIGTERM) are handled by the CLI, which aborts
  // the run first; this is the last-resort net for every other exit path.
  process.on('exit', () => {
    for (const pid of live) killTree(pid, 'SIGKILL')
  })
}
