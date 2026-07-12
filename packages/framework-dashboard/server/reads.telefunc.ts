// Re-export shim (#405): the read-model telefunctions live in @gemstack/framework so the
// daemon serves them in-process. Keeping this file at `server/reads.telefunc.ts` means
// the client bakes the RPC key `/server/reads.telefunc.ts` — the exact key the daemon
// registers the impls under (see framework's dashboard-rpc/register.ts). The telefunc
// Vite transform turns these named re-exports into client RPC stubs.
export { onRuns, onRun, onDocs, onProjectLog, onQueue } from '@gemstack/framework/dashboard-rpc'
