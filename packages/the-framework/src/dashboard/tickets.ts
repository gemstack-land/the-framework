import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TICKETS_DIR } from '../tickets.js'

/**
 * One ticket in `tickets/` (#697). The dashboard lists these so the backlog the agent plans
 * from is visible without opening the repo.
 */
export interface WorkspaceTicket {
  /** Filename inside `tickets/`, which is also its identity. */
  file: string
  /** The `# ` heading, else the filename made readable. */
  title: string
  /** The `## TLDR` line, else the first prose line. Empty when the ticket has neither. */
  summary: string
  /** The optional `priority:` key, verbatim and lowercased. */
  priority?: string
  /** Whether `<name>.spike.md` sits beside it. */
  spiked: boolean
  /** Whether `<name>.plan.md` sits beside it, i.e. #685 already planned it. */
  planned: boolean
}

/** How much of a ticket is read looking for its heading and TLDR. */
const MAX_TICKET_BYTES = 4_000

/** A ticket's siblings, which are not tickets of their own. */
const SIBLING = /\.(plan|spike)\.md$/

/**
 * A filename made readable, for a ticket with no heading. The format is
 * `<DATE>_<SLUG>.md`, but the tickets imported from GitHub are `<number>-<escaped title>.md`,
 * so decoding and de-underscoring gets both most of the way there.
 */
function titleFromFile(file: string): string {
  const withoutExt = file.replace(/\.md$/, '')
  try {
    return decodeURIComponent(withoutExt).replace(/_/g, ' ')
  } catch {
    // A stray `%` is not an escape; the raw name still reads better than throwing.
    return withoutExt.replace(/_/g, ' ')
  }
}

/**
 * Read the head of a ticket: the optional `key: value` block above the title (`priority:`,
 * `topics:`, and whatever else is agreed later), the `# ` heading, and the `## TLDR`.
 *
 * Deliberately tolerant. The tickets already in a repo predate the format (they are GitHub
 * imports: a heading, prose, and a trailing `Source:` line), so anything missing falls back
 * rather than dropping the ticket from the list.
 */
function describe(md: string): { title?: string; summary: string; priority?: string } {
  const lines = md.split('\n')
  const heading = lines.find(line => line.startsWith('# '))?.slice(2).trim()

  // The key block is above the title, so stop there rather than reading keys out of the body.
  const headingAt = lines.findIndex(line => line.startsWith('# '))
  const preamble = headingAt === -1 ? [] : lines.slice(0, headingAt)
  const priority = preamble
    .find(line => line.toLowerCase().startsWith('priority:'))
    ?.slice('priority:'.length)
    .trim()
    .toLowerCase()

  // The TLDR is the ticket in one line, which is exactly what a list row wants.
  const tldrAt = lines.findIndex(line => line.trim().toLowerCase() === '## tldr')
  const body = tldrAt === -1 ? lines.slice(headingAt + 1) : lines.slice(tldrAt + 1)
  const summary =
    body.find(line => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('Source:'))?.trim() ?? ''

  return { ...(heading ? { title: heading } : {}), ...(priority ? { priority } : {}), summary }
}

/**
 * The project's tickets, by filename. `[]` when the repo has no `tickets/` directory at all,
 * which is the state the view offers to import into.
 *
 * A `.spike.md` or `.plan.md` is written *about* a ticket rather than being one, so it never
 * becomes a row of its own: it marks its ticket instead.
 */
export async function readTickets(cwd: string): Promise<WorkspaceTicket[]> {
  const dir = join(cwd, TICKETS_DIR)
  const names = await readdir(dir).catch(() => [] as string[])
  const md = names.filter(name => name.endsWith('.md')).sort()
  const siblings = new Set(md.filter(name => SIBLING.test(name)))
  const tickets: WorkspaceTicket[] = []
  for (const file of md) {
    if (siblings.has(file)) continue
    // Only the head: a ticket can be long, and nothing below it is shown.
    const content = await readFile(join(dir, file), 'utf8').catch(() => undefined)
    if (content === undefined) continue
    const stem = file.replace(/\.md$/, '')
    const { title, summary, priority } = describe(content.slice(0, MAX_TICKET_BYTES))
    tickets.push({
      file,
      title: title ?? titleFromFile(file),
      summary,
      ...(priority ? { priority } : {}),
      spiked: siblings.has(`${stem}.spike.md`),
      planned: siblings.has(`${stem}.plan.md`),
    })
  }
  return tickets
}
