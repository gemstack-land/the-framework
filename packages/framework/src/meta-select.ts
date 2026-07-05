import type { DomainPreset } from '@gemstack/ai-autopilot'
import type { DriverSession } from './driver/index.js'
import { OPEN_LOOP_MODES } from './events.js'

/**
 * AI meta-select (#204, Rom's "meta-meta prompt"): before a run, infer which Open
 * Loop domain preset (plus its modes and build event kind) best fits what the user
 * asked for and the workspace they are in — so `framework "add a login page"` in a
 * web app picks the Web Development preset on its own, with no `--preset` flag or
 * `the-framework.yml`. It is a *selection* over the shipped catalog, not a new
 * kind of thing: it returns the same inputs a user would have typed, then the run
 * proceeds exactly as if they had.
 *
 * Kept out of `runFramework`: the CLI already owns preset discovery + resolution
 * (flags, the-framework.yml), and this is one more source that feeds the same
 * `resolveDomainPreset` path. Live only — `--fake` stays deterministic.
 */

/** The Open Loop modes a run can activate. Mirrors the CLI's `--autopilot` / `--technical`. */
export const META_SELECT_MODES = OPEN_LOOP_MODES

/** The system framing for the meta-select turn: a tiny, fast classifier, not a builder. */
export const META_SELECT_SYSTEM =
  'You are a router that picks the best-fit build policy for a coding task. ' +
  'You do not write or run any code — you only choose from the given options and reply with one JSON object.'

/** What the model needs to know about one shipped preset to choose it. */
export interface PresetCatalogEntry {
  name: string
  title: string
  description: string
  /** The build event kinds this preset actually has a review loop for (e.g. `major-change`, `bug-fix`). */
  eventKinds: string[]
  /** The kind dispatched when the run does not pick one; absent means `major-change`. */
  defaultEvent?: string
}

/** The inferred selection: the same inputs `--preset` / `--autopilot` / `--kind` would have supplied. */
export interface MetaSelection {
  /** The chosen preset name, validated against the catalog. Absent = no preset fits; run the plain flow. */
  preset?: string
  /** The chosen modes, a validated subset of {@link META_SELECT_MODES}. */
  modes: string[]
  /** The chosen build event kind, validated against the chosen preset's `eventKinds`. Absent = the preset default. */
  buildEvent?: string
  /** One-line rationale, shown to the user so the auto-pick is legible. */
  why?: string
}

/** Derive the {@link PresetCatalogEntry} list the router chooses from. */
export function presetCatalog(presets: readonly DomainPreset[]): PresetCatalogEntry[] {
  return presets.map(p => {
    const eventKinds = [...new Set(p.loops.flatMap(l => [...l.on]))]
    return {
      name: p.name,
      title: p.title,
      description: p.description,
      eventKinds,
      ...(p.defaultEvent ? { defaultEvent: p.defaultEvent } : {}),
    }
  })
}

/**
 * Compose the router prompt: the task, a one-line summary of the workspace, and
 * the catalog of presets + modes to choose from. Asks for exactly one JSON object.
 */
export function metaSelectPrompt(intent: string, catalog: readonly PresetCatalogEntry[], workspace: string): string {
  const presetLines = catalog.map(
    p => `- ${p.name}: ${p.title} — ${p.description} (build kinds: ${p.eventKinds.join(', ') || 'none'})`,
  )
  return [
    'Pick the build policy that best fits this coding task.',
    `Task: ${intent}`,
    `Workspace: ${workspace}`,
    '',
    'Available domain presets (a preset frames the review loop for the build):',
    ...presetLines,
    '',
    'Modes (optional, activate any that apply):',
    '- technical: the user is technical; keep the review lean and skip hand-holding.',
    '- autopilot: run with minimal check-ins.',
    '',
    'Choose the single best preset, or "none" if none clearly fits (then the plain framework flow runs).',
    'If you pick a preset, choose its build kind from that preset\'s list: "bug-fix" when the task is fixing',
    'a defect, otherwise "major-change" (or leave it out to use the preset default).',
    '',
    'Respond with ONLY a fenced ```json block of the shape:',
    '{ "preset": "<name|none>", "modes": ["technical"?, "autopilot"?], "event": "<kind|default>", "why": "<one line>" }',
  ].join('\n')
}

/**
 * Parse and validate the router's reply into a {@link MetaSelection}. Everything is
 * validated against what actually ships: an unknown preset name, mode, or event
 * kind is dropped rather than trusted, so a loose reply can only ever *narrow* to a
 * safe selection (worst case: no preset, i.e. the plain flow). Never throws.
 */
export function parseMetaSelection(text: string, catalog: readonly PresetCatalogEntry[]): MetaSelection {
  const obj = lastJsonObject(text)
  const rawPreset = typeof obj?.['preset'] === 'string' ? obj['preset'].trim() : ''
  const entry = catalog.find(p => p.name === rawPreset)
  const modes = coerceStrings(obj?.['modes']).filter((m): m is string =>
    (META_SELECT_MODES as readonly string[]).includes(m),
  )
  const why = typeof obj?.['why'] === 'string' && obj['why'].trim() ? obj['why'].trim() : undefined
  // No matching preset: the modes/event have nothing to act on, so return the
  // plain-flow selection (only `why`, if the model explained itself).
  if (!entry) return { modes: [], ...(why ? { why } : {}) }
  const rawEvent = typeof obj?.['event'] === 'string' ? obj['event'].trim() : ''
  const buildEvent = entry.eventKinds.includes(rawEvent) ? rawEvent : undefined
  return {
    preset: entry.name,
    modes,
    ...(buildEvent ? { buildEvent } : {}),
    ...(why ? { why } : {}),
  }
}

/**
 * Run the meta-select turn against a live driver session and parse its reply.
 * One fresh prompt, no tools — a fast classification the wrapped agent answers as
 * JSON. The caller supplies a short-lived session (dispose it after); on any error
 * the caller falls back to the plain flow.
 */
export async function metaSelect(
  session: DriverSession,
  opts: { intent: string; catalog: readonly PresetCatalogEntry[]; workspace: string; signal?: AbortSignal },
): Promise<MetaSelection> {
  const turn = await session.prompt(metaSelectPrompt(opts.intent, opts.catalog, opts.workspace), {
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  return parseMetaSelection(turn.text, opts.catalog)
}

function coerceStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim())
}

const FENCE = /```(?:[a-zA-Z0-9]*)\n([\s\S]*?)```/g

/** Extract the last JSON object from text: last fenced block, else a trailing `{...}`. */
function lastJsonObject(text: string): Record<string, unknown> | undefined {
  if (!text) return undefined
  const candidates: string[] = []
  for (const m of text.matchAll(FENCE)) candidates.push(m[1]!)
  const open = text.lastIndexOf('{')
  const close = text.lastIndexOf('}')
  if (open !== -1 && close > open) candidates.push(text.slice(open, close + 1))
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]!.trim())
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try the next candidate
    }
  }
  return undefined
}
