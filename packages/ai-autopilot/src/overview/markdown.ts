import type { CodeOverview, OverviewSection } from './types.js'

/**
 * `CODE-OVERVIEW.md` is the canonical form — human-editable and diff-friendly, so
 * a maintainer (or a person) can hand-correct it. These round-trip it to/from the
 * {@link CodeOverview} data. Shape:
 *
 * ```md
 * # Code Overview
 *
 * <summary paragraph>
 *
 * ## Structure
 * <body>
 *
 * ## Key modules
 * <body>
 * ```
 */

const TITLE = '# Code Overview'

/** Serialize a {@link CodeOverview} to `CODE-OVERVIEW.md`. */
export function serializeOverview(overview: CodeOverview): string {
  const parts = [TITLE]
  const summary = overview.summary.trim()
  if (summary) parts.push(summary)
  for (const section of overview.sections) {
    const title = section.title.trim()
    if (!title) continue
    parts.push(`## ${title}`)
    const body = section.body.trim()
    if (body) parts.push(body)
  }
  return parts.join('\n\n') + '\n'
}

/**
 * Parse `CODE-OVERVIEW.md` back into a {@link CodeOverview}. Tolerant: a missing
 * `# Code Overview` title is fine, the text before the first `##` is the summary,
 * and each `## Heading` starts a section. An empty string yields an empty overview.
 */
export function parseOverview(markdown: string): CodeOverview {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  let summaryLines: string[] = []
  const sections: OverviewSection[] = []
  let current: { title: string; body: string[] } | undefined

  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      if (current) sections.push({ title: current.title, body: current.body.join('\n').trim() })
      current = { title: heading[1]!.trim(), body: [] }
      continue
    }
    if (/^#\s+/.test(line)) continue // the top-level `# Code Overview` title
    if (current) current.body.push(line)
    else summaryLines.push(line)
  }
  if (current) sections.push({ title: current.title, body: current.body.join('\n').trim() })

  return { summary: summaryLines.join('\n').trim(), sections }
}
