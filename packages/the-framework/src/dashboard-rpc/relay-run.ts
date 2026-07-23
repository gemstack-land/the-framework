import { contextRemote } from './context.js'
import { relayRpc } from '../dashboard/remote-run.js'

/**
 * Run a run-scoped RPC locally, or relay it to the device when `runId` names a run this daemon is
 * relaying to a connected one (#1067 slice 2). For an ordinary local run the remote lookup is empty and
 * `local()` runs unchanged. For a remote run there is no local checkout, so the call is forwarded to the
 * device over the token; if the device is unreachable, `unreachable` is returned - the same empty/error
 * shape `local()` gives on a failed read - so the caller never special-cases a remote run.
 */
export async function relayOr<T>(
  runId: string | undefined,
  fn: string,
  args: unknown[],
  local: () => Promise<T>,
  unreachable: T,
): Promise<T> {
  const target = contextRemote()?.target(runId)
  if (!target) return local()
  try {
    return (await relayRpc(target, fn, args)) as T
  } catch {
    return unreachable
  }
}
