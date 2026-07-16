import { renderTemplate } from './prompt-template.js'
import { SYSTEM_PROMPT } from './prompts.generated.js'
import { AWAIT_PROTOCOL, SIGNAL_PROTOCOL } from './turn-gate.js'

// No Node imports here, deliberately. This module composes the prompt and the
// dashboard renders it in the browser (#520), so reading the user's SYSTEM.md off
// disk lives in `system-prompt-file.ts` instead. Keep it that way: one `node:fs`
// import here puts `node:fs` in the browser bundle.

/**
 * The system prompt (#326), verbatim, as a template. It supersedes the
 * anti-lazy-pill (#297/#301) it grew out of: the prompt is analyzed first into an
 * ANLYSIS_RESULT.md, an ambiguous prompt becomes a ranked `showChoices()` list, a
 * large scope becomes a PLAN file to approve, a very large one also spins off a TODO
 * backlog (consumed by the backlog loop, #323), the work moves onto its own
 * `the-framework/<session>` branch before the first change, and the alternatives flow
 * rates problem "variability" before code is written.
 *
 * Two layers make it executable:
 * - `${{ ... }}` fragments are JS evaluated against a {@link TfContext} (#350).
 * - The trailing `# User prompt` section is the user-prompt slot; use
 *   {@link renderSystemPrompt} to render and split the two halves.
 *
 * The `<SHOW_*>` / `<AWAIT>` macros are interpreted by the agent itself (Rom's
 * call on #326); the await protocol (#337/#339) pins how the stop-signal is
 * emitted so the turn-boundary gates can detect it.
 *
 * The text lives in `prompts/system_prompt.md` (#551), not here. It is Rom's living
 * doc: change it on #326 first, then sync the markdown.
 */
export const SYSTEM_PROMPT_TEMPLATE = SYSTEM_PROMPT

/**
 * Eco fine-grained control (#314): each flag drops one whole section from the
 * built-in #326 prompt to save tokens, letting the agent auto-handle that concern.
 * The template itself stays byte-identical to the #326 doc; the sections are
 * removed after the split, so a dropped section never leaves a fragment behind.
 */
export interface EcoOptions {
  /** Drop `### Scope` (the PLAN-file planning section). */
  autoPlanning?: boolean | undefined
  /** Drop `### Alternatives` (the variability-rating research section). */
  autoResearch?: boolean | undefined
  /**
   * Drop `## Maintenance`. Nothing to drop *here*: #326 moved that section out of the
   * system prompt and into the on-before-mergeable prompt, so this flag acts on that prompt
   * instead (#556) — see {@link ./on-before-mergeable-prompt.renderOnBeforeMergeablePrompt}. Listed here
   * because it is still an {@link EcoOptions} flag.
   */
  autoMaintenance?: boolean | undefined
}

/**
 * Maps an {@link EcoOptions} flag to the heading it drops from the template. Partial: a
 * flag whose section no longer lives in this prompt has no entry.
 *
 * Every entry must match a heading that really exists. {@link dropSection} no-ops on a
 * miss, so a heading rename in the #326 doc would silently stop the flag from trimming
 * anything, with no test failure to catch it (a `!includes('## Large scope')` assertion
 * passes for free once that heading is gone). `system-prompt.test.ts` pins each entry
 * against the template and asserts the drop actually shortens the prompt.
 */
const ECO_SECTION_HEADINGS: Partial<Record<keyof EcoOptions, string>> = {
  autoPlanning: '### Scope',
  autoResearch: '### Alternatives',
}

/**
 * The `tf` context the templates' `${{...}}` fragments read (#326/#350). One shape across
 * the prompts; each reads the subset it needs. `session_name` and `settings` are the
 * on-before-mergeable prompt's (#556), and are snake_case because the doc writes them that way.
 */
export interface TfContext {
  /** The user's prompt (the run intent, or the typed prompt): fills `${{tf.prompt}}`. */
  prompt: string
  /** Run parameters the template branches on (e.g. `autopilot`, #325's mode sense; `eco`, #314). */
  params: { autopilot?: boolean; eco?: EcoOptions | undefined } & Record<string, unknown>
  /**
   * The session name the agent set via setSessionName(), carried on run state. Only the
   * on-before-mergeable prompt reads it, never the system prompt: it is set before the agent makes
   * changes and read afterwards, so it is not chicken-and-egg.
   */
  session_name?: string | undefined
  /** The user's persisted settings the prompts branch on (the #314 Global options). */
  settings?: { technical_control?: boolean | undefined } | undefined
}

/** The neutral context used when a caller has none: empty prompt, no modes. */
const DEFAULT_TF: TfContext = { prompt: '', params: {} }

/**
 * The project-knowledge documents (#537): what the repo knows about itself, as markdown
 * that travels with the code. {@link systemPromptBlock} puts them in front of every run
 * as in-context paths; the on-before-mergeable prompt asks the agent to update them, which is what
 * keeps them current. Repo-root, because that is the agent's cwd and where the docs live.
 * Each carries the one-line gloss Rom wants shown alongside the path (#559). README is
 * left out: a repo's own `README.md` already covers the overview.
 */
export const KNOWLEDGE_DOCS: readonly { path: string; comment: string }[] = [
  { path: 'DECISIONS.md', comment: 'decisions taken, and why' },
  { path: 'KNOWLEDGE-BASE.md', comment: 'knowledge and insights related to the project' },
]

/** The two halves of the rendered {@link SYSTEM_PROMPT_TEMPLATE}. */
export interface RenderedSystemPrompt {
  /** The `# System prompt` half: frames the session's system channel. */
  system: string
  /** The `# User prompt` half: the rendered user-prompt slot (`${{tf.prompt}}` plus any framing Rom adds around it). */
  user: string
}

const USER_PROMPT_HEADING = '\n# User prompt\n'

/**
 * Drop a whole `<heading>` section from a markdown block: everything from the heading
 * up to (but not including) the next heading of the same or a higher level, or the end.
 * The `\n\n` separator ahead of the section goes with it, so the surrounding blocks stay
 * spaced exactly as before. A heading that isn't present is a no-op.
 *
 * Level-aware because #326 nests the eco-droppable sections under `##` parents: dropping
 * `### Scope` has to stop at the next `###` sibling rather than run on to the next `##`
 * and swallow it.
 */
export function dropSection(md: string, heading: string): string {
  const at = md.indexOf(`\n${heading}`)
  if (at === -1) return md
  const level = /^#+/.exec(heading)?.[0].length ?? 2
  const after = at + heading.length + 1
  const next = new RegExp(`\\n#{1,${level}} `).exec(md.slice(after))
  const end = next ? after + next.index : md.length
  return md.slice(0, at) + md.slice(end)
}

/** Remove each Eco-enabled section from the template's system half (#314). */
function applyEco(systemHalf: string, eco: EcoOptions | undefined): string {
  if (!eco) return systemHalf
  let out = systemHalf
  for (const [key, heading] of Object.entries(ECO_SECTION_HEADINGS) as [keyof EcoOptions, string][]) {
    if (eco[key]) out = dropSection(out, heading)
  }
  return out
}

/**
 * Render the built-in system prompt against a {@link TfContext} and split it at
 * the `# User prompt` heading. The split happens on the *template*, before
 * rendering, so a user prompt that itself contains the heading can never move
 * the boundary. Eco flags (#314) drop their sections from the system half here,
 * before rendering, so a dropped section's `${{...}}` fragments never evaluate.
 */
export function renderSystemPrompt(tf: TfContext = DEFAULT_TF): RenderedSystemPrompt {
  const at = SYSTEM_PROMPT_TEMPLATE.indexOf(USER_PROMPT_HEADING)
  const rawSystemHalf = at === -1 ? SYSTEM_PROMPT_TEMPLATE : SYSTEM_PROMPT_TEMPLATE.slice(0, at)
  const systemHalf = applyEco(rawSystemHalf, tf.params.eco)
  const userHalf = at === -1 ? '${{tf.prompt}}' : SYSTEM_PROMPT_TEMPLATE.slice(at + USER_PROMPT_HEADING.length)
  return {
    system: renderTemplate(systemHalf, { tf }).trim(),
    user: renderTemplate(userHalf, { tf }).trim(),
  }
}

/**
 * The canonical user system-prompt file at the workspace root. Its contents are
 * injected into every prompt, so a project's own instructions travel with the
 * code (Rom's repo-as-database model, like the memory files in {@link ./memory}).
 */
/** Inputs to {@link systemPromptBlock}. */
export interface SystemPromptOptions {
  /**
   * Include the built-in #326 system prompt. Default `true`; set false per repo
   * to remove it. The name is the historical `the-framework.yml` key (#301): the
   * #326 prompt is the anti-lazy-pill's successor and answers to the same toggle.
   */
  antiLazyPill?: boolean | undefined
  /** The user's own system prompt (e.g. from `SYSTEM.md`), injected after the built-in one. */
  user?: string | undefined
  /** Context for the template's `${{...}}` fragments. Default: {@link DEFAULT_TF}. */
  tf?: TfContext | undefined
  /**
   * Directories the user picked as in-context (#439/#314). The agent can reach every
   * registered repo, so this narrows its focus: it prepends one `Context: <dirs>` line to
   * the block. Empty/absent adds nothing.
   */
  context?: readonly string[] | undefined
}

/**
 * Compose the system-prompt block injected into every prompt: the built-in #326
 * prompt (unless removed) followed by the user's own prompt. Additive, so a repo
 * can keep the built-in *and* add its instructions, remove it and keep only its
 * own, or leave both off. Returns `''` when there is nothing to inject. Only the
 * template's system half lands here; the user-prompt half is the caller's to
 * deliver (see {@link renderSystemPrompt}).
 */
export function systemPromptBlock(opts: SystemPromptOptions = {}): string {
  const parts: string[] = []
  // The #439 context line goes first, so it frames whatever prompt follows (or stands
  // alone under `--vanilla`, where there is no built-in prompt to frame).
  const dirs = opts.context?.map(d => d.trim()).filter(Boolean) ?? []
  // The knowledge docs ride with the built-in prompt, not with the user's dirs: they are
  // ours, and `--vanilla` means no framework-authored prompt at all (#547 rule 3). They
  // render as commented bullets under the dirs (#559), so the agent sees what each is for.
  const docs = opts.antiLazyPill === false ? [] : KNOWLEDGE_DOCS
  if (dirs.length || docs.length) {
    const head = `Context:${dirs.length ? ` ${dirs.join(', ')}` : ''}`
    const bullets = docs.map(d => `- \`${d.path}\` (${d.comment})`)
    parts.push([head, ...bullets].join('\n'))
  }
  if (opts.antiLazyPill !== false) parts.push(renderSystemPrompt(opts.tf).system)
  const user = opts.user?.trim()
  if (user) parts.push(user)
  return parts.join('\n\n')
}

/** Inputs to {@link composeRunSystem}. */
export type RunSystemOptions = SystemPromptOptions

/**
 * Assemble a run's full system channel — the single place it is composed (#501), so the
 * build path ({@link ./run.runFramework}) and the direct-prompt path ({@link ./prompt-run.runPrompt})
 * cannot drift. That drift is exactly what dropped the #326 action layer from `--vanilla`
 * builds (#500): the two sites each inlined the composition and one nested the protocols
 * inside the built-in-prompt branch.
 *
 * Order is fixed: the #326 prompt block (context / built-in prompt / user SYSTEM.md)
 * first, then the always-on emit protocols. Nothing else is appended — a
 * build run's system channel is exactly this (#547), which is what lets the dashboard
 * show the whole prompt before a run starts (#520). The protocols are unconditional —
 * they are the *emit contract* (how the agent signals an awaited choice and the
 * setSessionName()/setReadyForMerge() lifecycle), not prompt content — so the agent
 * needs them even with the built-in prompt off.
 */
export function composeRunSystem(opts: RunSystemOptions = {}): string {
  const promptBlock = systemPromptBlock(opts)
  return [...(promptBlock ? [promptBlock] : []), AWAIT_PROTOCOL, SIGNAL_PROTOCOL].join('\n\n')
}
