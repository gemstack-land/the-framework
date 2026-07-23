import { onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent, onGitStatus, onRunWorktree, onRunHandoff, onRun } from './reads.telefunc.js'
import { sendStop, sendChoice, sendMessage, sendPushBranch, sendOpenPullRequest } from './control.telefunc.js'

// The device side of the remote-run relay (#1067 slice 2). A daemon that relayed a run here asks this
// to read/steer/hand off THAT run against THIS device's own checkout. Every entry is a run-scoped RPC
// the dashboard already exposes to its own browser. The only change: arg[0] (the remote daemon's
// project id, meaningless here) is replaced with this device's home project id, so a relayed call can
// only ever address the device's own home checkout, never another registered project. These functions
// resolve their path through the same registry the browser's own calls do (the home project is
// registered at daemon start) and use no Telefunc request context, so calling them directly is sound.
// Whitelist only: start/preview/delete stay OFF it.

type RelayFn = (...args: unknown[]) => Promise<unknown>
const RELAY_FNS = {
  onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent,
  onGitStatus, onRunWorktree, onRunHandoff, onRun,
  sendStop, sendChoice, sendMessage, sendPushBranch, sendOpenPullRequest,
} as unknown as Record<string, RelayFn>

/** The names a relay caller may invoke. */
export const RELAY_RPC_NAMES: readonly string[] = Object.keys(RELAY_FNS)

/**
 * Dispatch one relayed RPC against `homeId` (this device's own project). `args[0]` from the caller is
 * the remote daemon's project id and is meaningless here, so it is replaced with `homeId`; the rest
 * (path, runId, ...) carry through unchanged. Throws on an unknown name.
 */
export async function dispatchRelayRpc(homeId: string, fn: string, args: unknown[]): Promise<unknown> {
  const impl = RELAY_FNS[fn]
  if (!impl) throw new Error(`unknown relay rpc: ${fn}`)
  return impl(homeId, ...args.slice(1))
}
