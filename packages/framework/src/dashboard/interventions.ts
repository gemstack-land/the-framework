import type { ProjectSummary } from './projects.js'

// The interventions queue (#632, part of the Queue #624): the cross-project "needs you" list.
// Rom's design (#624): proposals and finished work are both just PRs, so the bulk of what
// needs a human is the set of open PRs across the registered projects — merge to confirm,
// close to reject. This rolls those up, the same way overview.ts rolls up running runs. The
// other source, a run paused at an await gate, is a follow-up; #627 notifications rides this.

/** One item awaiting the human. Today always a PR; the shape leaves room for a paused run later. */
export interface Intervention {
  projectId: string
  projectName: string
  /** What kind of attention this needs. `pr` = an open PR to review/merge or close. */
  kind: 'pr'
  number: number
  title: string
  url: string
  /** When the PR was opened (ISO), for ordering. */
  createdAt?: string
}

/** An open PR as the lister reports it. */
export interface OpenPr {
  number: number
  title: string
  url: string
  /** Draft PRs are not ready for review, so they are left off the queue. */
  isDraft: boolean
  createdAt?: string
}

/** Lists a checkout's open PRs; resolves `[]` when there is no remote / gh is unavailable. */
export type PrLister = (cwd: string) => Promise<OpenPr[]>

/** A {@link PrLister} via the `gh` CLI; resolves `[]` when gh is missing/unauthed or there is no remote. */
export function nodeGhPrLister(): PrLister {
  return cwd =>
    new Promise(resolve => {
      void import('node:child_process').then(({ execFile }) => {
        const args = ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url,isDraft,createdAt']
        execFile('gh', args, { cwd, timeout: 8_000 }, (err, stdout) => {
          if (err) return resolve([])
          try {
            resolve(JSON.parse(String(stdout)) as OpenPr[])
          } catch {
            resolve([])
          }
        })
      })
    })
}

/** Injectable seam so {@link buildInterventions} is unit-testable off disk. */
export interface InterventionsDeps {
  prs?: PrLister
}

/**
 * Build the cross-project interventions queue: every registered project's open, non-draft PRs,
 * newest first. Forgiving — a project with no remote (or an unreadable one) simply contributes
 * nothing. Draft PRs are excluded: they are not yet asking for review.
 */
export async function buildInterventions(
  projects: ProjectSummary[],
  deps: InterventionsDeps = {},
): Promise<Intervention[]> {
  const prs = deps.prs ?? nodeGhPrLister()
  const items: Intervention[] = []
  for (const project of projects) {
    const open = await prs(project.path).catch(() => [])
    for (const pr of open) {
      if (pr.isDraft) continue
      items.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'pr',
        number: pr.number,
        title: pr.title,
        url: pr.url,
        ...(pr.createdAt ? { createdAt: pr.createdAt } : {}),
      })
    }
  }
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return items
}
