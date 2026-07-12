import { useState } from 'react'
import { ProjectsSidebar } from '../../components/ProjectsSidebar.js'
import { EventStream } from '../../components/EventStream.js'
import { Badge } from '../../components/ui/badge.js'

// The spike's thin slice (#406): Projects sidebar (Telefunc RPC) on the left, the
// selected project's live event stream (SSE) filling the rest. Enough real surface
// to judge the component model + shadcn + Telefunc against the MVP page.ts dashboard.
export default function Page() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="font-semibold">The Framework</span>
        <Badge className="text-muted-foreground">dashboard spike</Badge>
        <span className="ml-auto text-xs text-muted-foreground">Vike · React · shadcn · Telefunc</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <ProjectsSidebar selectedId={selectedId} onSelect={setSelectedId} />
        <main className="flex min-w-0 flex-1 flex-col">
          <EventStream projectId={selectedId} />
        </main>
      </div>
    </div>
  )
}
