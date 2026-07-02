import { defineDecision } from './define.js'
import type { Decision, DecisionSpec, DecisionStatus } from './types.js'

/**
 * The `DECISIONS.md` format — human-first and git-friendly, so the user can read
 * and edit the same file the agent consults. One `##` section per decision:
 *
 * ```md
 * # Decisions
 *
 * ## [rejected] Use Redux for state
 * - id: use-redux-for-state
 * - tags: state, frontend
 * - date: 2026-07-02
 *
 * Too much boilerplate for an app this size; Zustand covers our needs.
 * ```
 *
 * The heading carries the status in brackets and the title; a metadata bullet
 * list (all optional) carries id/tags/date/superseded-by; the prose beneath is
 * the rationale. Parsing is forgiving — a missing `[status]` defaults to
 * `rejected` and unknown metadata keys are ignored — so a hand-edited file still
 * loads. {@link serializeDecisions} and {@link parseDecisions} round-trip.
 */
const HEADER = '# Decisions'
const INTRO =
  'Settled choices and rejected ideas. The agent reads this before proposing, so it does not\n' +
  're-pitch what was already turned down. Edit freely; one `##` section per decision.'

const STATUSES: readonly DecisionStatus[] = ['rejected', 'accepted', 'superseded']

/** Render decisions to `DECISIONS.md` contents. */
export function serializeDecisions(decisions: readonly Decision[]): string {
  const blocks = decisions.map(d => {
    const meta = [`- id: ${d.id}`]
    if (d.tags.length) meta.push(`- tags: ${d.tags.join(', ')}`)
    if (d.date) meta.push(`- date: ${d.date}`)
    if (d.supersededBy) meta.push(`- superseded-by: ${d.supersededBy}`)
    return `## [${d.status}] ${d.title}\n${meta.join('\n')}\n\n${d.rationale}`
  })
  return `${HEADER}\n\n${INTRO}\n\n${blocks.join('\n\n')}\n`.replace(/\n{3,}/g, '\n\n')
}

const HEADING_RE = /^##\s+(?:\[(\w+)\]\s*)?(.+?)\s*$/
const META_RE = /^-\s+([a-z-]+)\s*:\s*(.*)$/i

/** Parse `DECISIONS.md` contents into decisions. Malformed sections are skipped. */
export function parseDecisions(markdown: string): Decision[] {
  const lines = markdown.split(/\r?\n/)
  const decisions: Decision[] = []

  let current: { spec: DecisionSpec; body: string[] } | null = null
  const flush = () => {
    if (!current) return
    const rationale = current.body.join('\n').trim()
    // A section with no rationale is incomplete; skip rather than throw so one
    // bad hand-edit does not sink the whole file.
    if (rationale) {
      try {
        decisions.push(defineDecision({ ...current.spec, rationale }))
      } catch {
        // ignore an unparseable section
      }
    }
    current = null
  }

  for (const line of lines) {
    const heading = HEADING_RE.exec(line)
    if (heading && !line.startsWith('# ')) {
      flush()
      const rawStatus = heading[1]?.toLowerCase()
      const status = (STATUSES as string[]).includes(rawStatus ?? '')
        ? (rawStatus as DecisionStatus)
        : 'rejected'
      current = { spec: { title: heading[2] ?? '', rationale: '', status }, body: [] }
      continue
    }
    if (!current) continue

    const meta = META_RE.exec(line)
    if (meta && current.body.length === 0) {
      const key = meta[1]?.toLowerCase()
      const value = meta[2]?.trim() ?? ''
      if (key === 'id') current.spec.id = value
      else if (key === 'date') current.spec.date = value
      else if (key === 'superseded-by') current.spec.supersededBy = value
      else if (key === 'tags') current.spec.tags = value.split(',').map(t => t.trim()).filter(Boolean)
      continue
    }

    current.body.push(line)
  }
  flush()

  return decisions
}
