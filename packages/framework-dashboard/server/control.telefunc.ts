// Re-export shim (#405): the steering telefunctions live in @gemstack/framework so the
// daemon serves them in-process. The file path keeps the baked RPC key
// `/server/control.telefunc.ts`. See framework's dashboard-rpc/register.ts.
export { sendStop, sendChoice } from '@gemstack/framework/dashboard-rpc'
