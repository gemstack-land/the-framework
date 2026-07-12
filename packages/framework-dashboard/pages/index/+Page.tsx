import { useState } from 'react'
import { ProjectsSidebar } from '../../components/ProjectsSidebar.js'
import { RunHistory } from '../../components/RunHistory.js'
import { EventStream } from '../../components/EventStream.js'
import { RunReplay } from '../../components/RunReplay.js'
import { RightRail } from '../../components/RightRail.js'
import { RelayView } from '../../components/RelayView.js'
import { Badge } from '../../components/ui/badge.js'

// The dashboard shell (#405 phase 2): Projects | Runs | main (live event stream or a
// past-run replay) | Docs/Log rail. Everything over the wire is Telefunc — the
// Projects RPC, run history, run replay, docs, log, and the live stream (a Channel).
// A projection of the same .the-framework files the daemon writes.
export default function Page() {
  const [projectId, setProjectId] = useState<string | null>(null)
  // null = follow the live stream; a run id = replay that archived run.
  const [runId, setRunId] = useState<string | null>(null)

  const selectProject = (id: string) => {
    setProjectId(id)
    setRunId(null) // switching projects always returns to live
  }

  // On the relay (#426), the URL carries `?run=<id>` and there is no local registry or
  // files — show that one run read-only. `window` is absent during prerender (ssr:false),
  // so this resolves to the full shell at build time and only flips in the browser. Hooks
  // above run unconditionally (rules of hooks); this early return is safe after them.
  const relayRun = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('run')
  if (relayRun) return <RelayView runId={relayRun} />

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="font-semibold">The Framework</span>
        <Badge className="text-muted-foreground">dashboard</Badge>
        <span className="ml-auto text-xs text-muted-foreground">Vike · React · shadcn · Telefunc</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <ProjectsSidebar selectedId={projectId} onSelect={selectProject} />
        <RunHistory projectId={projectId} selectedRunId={runId} onSelect={setRunId} />
        <main className="flex min-w-0 flex-1 flex-col">
          {projectId && runId ? <RunReplay projectId={projectId} runId={runId} /> : <EventStream projectId={projectId} />}
        </main>
        <RightRail projectId={projectId} />
      </div>
    </div>
  )
}
