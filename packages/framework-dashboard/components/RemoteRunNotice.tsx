import { MonitorSmartphone } from 'lucide-react'

// The run view's banner for a session running on a connected device (#1067, slice 1). The live feed
// streams back through the local daemon and renders normally; what does NOT work yet lives on the
// remote device (its worktree, diff, PR, handoff, and browser screencast), so this says where the
// run executes and that those panels are not wired for remote runs yet. Renders nothing without a
// device label, so the run view can mount it unconditionally.
export function RemoteRunNotice({ device }: { device?: string | undefined }) {
  if (!device) return null
  return (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Running on {device}. The live output streams here; the diff, PR, and browser panels are not available for remote runs yet.
      </span>
    </div>
  )
}
