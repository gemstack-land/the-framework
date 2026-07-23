// Re-export shim (#405): the Projects telefunction lives in @gemstack/the-framework so the
// daemon serves it in-process. The file path keeps the baked RPC key
// `/server/projects.telefunc.ts`. See framework's dashboard-rpc/register.ts.
// Imported then exported, not re-exported (#1014): telefunc's dev transform appends
// `__decorateTelefunction(<name>, ...)` per export, which needs a local binding. An
// `export ... from` creates none, so `pnpm dev` died with `<name> is not defined`.
import { onProjects, sendAddProject, onOnboarding } from '@gemstack/the-framework/dashboard-rpc'

export { onProjects, sendAddProject, onOnboarding }
