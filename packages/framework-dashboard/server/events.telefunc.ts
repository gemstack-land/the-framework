// Re-export shim (#405): the live-event Channel telefunction lives in @gemstack/framework
// so the daemon serves it in-process. The file path keeps the baked RPC key
// `/server/events.telefunc.ts`. See framework's dashboard-rpc/register.ts.
export { onEvents } from '@gemstack/framework/dashboard-rpc'
