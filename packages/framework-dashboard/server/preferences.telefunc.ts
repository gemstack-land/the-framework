// Re-export shim (#410): the user-preferences telefunctions live in @gemstack/framework so the
// daemon serves them in-process, reading/writing the same `the-framework.json` as the registry.
// Keeping this file at `server/preferences.telefunc.ts` means the client bakes the RPC key
// `/server/preferences.telefunc.ts` — the exact key the daemon registers the impls under (see
// framework's dashboard-rpc/register.ts). The telefunc Vite transform turns these named
// re-exports into client RPC stubs.
export { onPreferences, savePreferences } from '@gemstack/framework/dashboard-rpc'
