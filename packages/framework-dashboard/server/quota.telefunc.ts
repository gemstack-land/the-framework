// Re-export shim (#535): the usage-panel telefunction lives in @gemstack/framework so the
// daemon serves it in-process, off the poller it owns for its whole life. Keeping this file
// at `server/quota.telefunc.ts` means the client bakes the RPC key `/server/quota.telefunc.ts`
// — the exact key the daemon registers the impl under (see framework's dashboard-rpc/register.ts).
export { onQuota } from '@gemstack/framework/dashboard-rpc'
