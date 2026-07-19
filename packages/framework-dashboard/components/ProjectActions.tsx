import { WorkspaceActions } from './WorkspaceActions.js'
import { GitStatusBar } from './GitStatusBar.js'
import { TooltipProvider } from './ui/tooltip.js'

// The project home's action bar (#488). Git status (#491) reads on the left, the actions group on
// the right. Both halves are shared with a session's bar (#809), so the two pages cannot drift:
// this one passes no session, and so reports and acts on the project's own checkout.
export function ProjectActions({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <TooltipProvider delay={300} closeDelay={0}>
        <GitStatusBar projectId={projectId} inline />
        <div className="min-w-0 flex-1" />
        <WorkspaceActions projectId={projectId} />
      </TooltipProvider>
    </div>
  )
}
