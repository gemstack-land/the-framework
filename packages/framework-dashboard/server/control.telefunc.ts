// Re-export shim (#405): the steering telefunctions live in @gemstack/the-framework so the
// daemon serves them in-process. The file path keeps the baked RPC key
// `/server/control.telefunc.ts`. See framework's dashboard-rpc/register.ts.
// Imported then exported, not re-exported (#1014): telefunc's dev transform appends
// `__decorateTelefunction(<name>, ...)` per export, which needs a local binding. An
// `export ... from` creates none, so `pnpm dev` died with `<name> is not defined`.
import { sendStop, sendChoice, sendMessage, sendSetHandoff, sendStart, sendPreview, onServeTargets, sendStopPreview, onPreviewStatus, sendOpenInApp, sendRemoveWorktree, sendDeleteSession, sendPushBranch, sendOpenPullRequest, sendQueueTicket } from '@gemstack/the-framework/dashboard-rpc'

export { sendStop, sendChoice, sendMessage, sendSetHandoff, sendStart, sendPreview, onServeTargets, sendStopPreview, onPreviewStatus, sendOpenInApp, sendRemoveWorktree, sendDeleteSession, sendPushBranch, sendOpenPullRequest, sendQueueTicket }
