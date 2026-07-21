// Re-export shim (#535): the usage-panel telefunction lives in @gemstack/framework so the
// daemon serves it in-process, off the poller it owns for its whole life. Keeping this file
// at `server/quota.telefunc.ts` means the client bakes the RPC key `/server/quota.telefunc.ts`
// — the exact key the daemon registers the impl under (see framework's dashboard-rpc/register.ts).
// Imported then exported, not re-exported (#1014): telefunc's dev transform appends
// `__decorateTelefunction(<name>, ...)` per export, which needs a local binding. An
// `export ... from` creates none, so `pnpm dev` died with `<name> is not defined`.
import { onQuota } from '@gemstack/framework/dashboard-rpc'

export { onQuota }
