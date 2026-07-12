// Re-export shim (#405): the Projects telefunction lives in @gemstack/framework so the
// daemon serves it in-process. The file path keeps the baked RPC key
// `/server/projects.telefunc.ts`. See framework's dashboard-rpc/register.ts.
export { onProjects } from '@gemstack/framework/dashboard-rpc'
