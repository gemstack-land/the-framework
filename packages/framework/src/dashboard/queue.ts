import type { ProjectSummary } from './projects.js'
import { readDocs, type WorkspaceDoc } from './docs.js'

// The cross-project Queue (#438, part of #314). The per-project docs rail already surfaces
// a project's TODO (see docs.ts / onDocs), but the first sidebar needs the aggregate: every
// registered project's open TODO items in one place. This parses the GitHub-style task-list
// items out of each project's surfaced TODO docs and rolls them up per project.

/** One TODO checklist entry: its text and whether it is checked off. */
export interface QueueItem {
  text: string
  done: boolean
}

/** One project's rolled-up TODO queue. */
export interface ProjectQueue {
  projectId: string
  projectName: string
  /** Count of unchecked items (what is still queued). */
  open: number
  /** Count of all parsed items (open + done). */
  total: number
  items: QueueItem[]
}

// A GitHub-style task-list line: `- [ ] text` or `* [x] text` (any leading indent).
const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/

/** Parse the task-list entries out of a TODO doc; non-checklist lines are ignored. */
export function parseTodoItems(content: string): QueueItem[] {
  const items: QueueItem[] = []
  for (const line of content.split('\n')) {
    const match = TASK_LINE.exec(line)
    if (match) items.push({ text: match[2]!, done: match[1] !== ' ' })
  }
  return items
}

/**
 * Roll up the open TODO queue across the given projects, most-open first. Reads each
 * project's surfaced TODO docs (the `TODO*` half of {@link readDocs}) and parses their
 * checklist items. `read` is injectable so this is unit-testable off disk. Projects with
 * no TODO doc or no checklist items are omitted; a read failure just skips that project.
 */
export async function collectQueue(
  projects: ProjectSummary[],
  read: (cwd: string) => Promise<WorkspaceDoc[]> = readDocs,
): Promise<ProjectQueue[]> {
  const queues: ProjectQueue[] = []
  for (const project of projects) {
    const docs = await read(project.path).catch(() => [])
    const items = docs.filter(d => d.name.startsWith('TODO')).flatMap(d => parseTodoItems(d.content))
    if (items.length === 0) continue
    const open = items.filter(i => !i.done).length
    queues.push({ projectId: project.id, projectName: project.name, open, total: items.length, items })
  }
  return queues.sort((a, b) => b.open - a.open)
}
