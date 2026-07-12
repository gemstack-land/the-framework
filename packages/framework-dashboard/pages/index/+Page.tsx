import { useState } from 'react'
import { ProjectsSidebar } from '../../components/ProjectsSidebar.js'
import { RunHistory } from '../../components/RunHistory.js'
import { EventStream } from '../../components/EventStream.js'
import { RunReplay } from '../../components/RunReplay.js'
import { RightRail } from '../../components/RightRail.js'
import { Badge } from '../../components/ui/badge.js'

// The dashboard shell (#405 phase 2): Projects | Runs | main (live SSE stream or a
// past-run replay) | Docs/Log rail. The Projects RPC, run history, run replay, docs
// and log are all Telefunc; the live stream is SSE. A projection of the same
// .the-framework files the daemon writes.
export default function Page() {
  const [projectId, setProjectId] = useState<string | null>(null)
  // null = follow the live stream; a run id = replay that archived run.
  const [runId, setRunId] = useState<string | null>(null)

  const selectProject = (id: string) => {
    setProjectId(id)
    setRunId(null) // switching projects always returns to live
  }

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
