// Re-export shim (#405): the read-model telefunctions live in @gemstack/the-framework so the
// daemon serves them in-process. Keeping this file at `server/reads.telefunc.ts` means
// the client bakes the RPC key `/server/reads.telefunc.ts` — the exact key the daemon
// registers the impls under (see framework's dashboard-rpc/register.ts).
// Imported then exported, not re-exported (#1014): telefunc's dev transform appends
// `__decorateTelefunction(<name>, ...)` per export, which needs a local binding. An
// `export ... from` creates none, so `pnpm dev` died with `<name> is not defined`.
import { onRuns, onRun, onDocs, onProjectLog, onQueue, onOverview, onRecentRuns, onHotTickets, onInterventions, onActivity, onDashboard, onGithubUrl, onGitStatus, onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent, onTickets, onRetainedWorktrees, onRunWorktree, onRunHandoff, onSystemPromptUser } from '@gemstack/the-framework/dashboard-rpc'

export { onRuns, onRun, onDocs, onProjectLog, onQueue, onOverview, onRecentRuns, onHotTickets, onInterventions, onActivity, onDashboard, onGithubUrl, onGitStatus, onProjectFiles, onProjectFileStatus, onFileDiff, onRunChanges, onFileContent, onTickets, onRetainedWorktrees, onRunWorktree, onRunHandoff, onSystemPromptUser }
