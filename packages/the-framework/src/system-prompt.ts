import { renderTemplate } from './prompt-template.js'
import { SYSTEM_PROMPT } from './prompts.generated.js'
import { AWAIT_PROTOCOL, BROWSER_PROTOCOL, SIGNAL_PROTOCOL } from './turn-gate.js'

/**
 * Topic-run bind protocol (#1121, gates spike): told only to a project-less "topic" run (#1120) so
 * the agent knows it can bind to a project mid-run, and how. It reuses the await-block emit format
 * {@link AWAIT_PROTOCOL} already taught, so it only names the two topic-specific tags. It lives in
 * this runtime append layer (a plain string) rather than the drift-guarded base prompt, so this
 * spike needs no `.md` edit and a normal run's channel stays byte-identical (#547). Kept topic-only.
 */
export const TOPIC_BIND_PROTOCOL = [
  '## Binding this run to a project',
  'This run started with no project, in a scratch directory with no repo. When your work needs a real project to act on, end your turn with one fenced block, then stop.',
  'To bind to a project that is already registered, tag it `await-bind-project` (the framework shows you the list of projects to pick from):',
  '```await-bind-project',
  '{ "title": "<why you need a project>" }',
  '```',
  'To register a new project by its absolute path and bind this run to it, tag it `await-create-project`:',
  '```await-create-project',
  '{ "title": "<what this project is>", "path": "<absolute repo path>" }',
  '```',
  'The framework registers and binds it, then re-prompts you with the result. Do not bind unless the work actually needs a repo.',
].join('\n')

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

/** A project-context document: a repo-root path and the one-line gloss shown beside it (#559). */
export interface ContextDoc {
  path: string
  comment: string
}

// The knowledge base lives under `knowledge-base/` (#683): one file per kind rather than a
// single flat doc, so the agent folds each learning back into the right file.
const DECISIONS_DOC: ContextDoc = { path: 'knowledge-base/DECISIONS.md', comment: 'decisions taken, and why' }
const FACTS_DOC: ContextDoc = { path: 'knowledge-base/FACTS.md', comment: 'non-obvious facts relevant to the project' }
const INSIGHTS_DOC: ContextDoc = { path: 'knowledge-base/INSIGHTS.md', comment: 'insights relevant to the project' }

/**
 * The business-knowledge docs (#537): what the repo has learned about itself, which the
 * agent both reads at the start of a run and folds new knowledge back into at merge. The
 * on-before-mergeable prompt's `## Business knowledge` section names this exact set, so the
 * agent is never told to read one set of files and update another (pinned by a test). A
 * subset of {@link CONTEXT_DOCS}.
 */
export const BUSINESS_KNOWLEDGE_DOCS: readonly ContextDoc[] = [DECISIONS_DOC, FACTS_DOC, INSIGHTS_DOC]

/**
 * Everything the agent keeps in context at the start of a run (#683), which
 * {@link systemPromptBlock} renders as the `Context:` bullets. A superset of
 * {@link BUSINESS_KNOWLEDGE_DOCS}: it adds `GOAL.md` and the roadmap/queue/history pointers the
 * agent reads but does *not* fold knowledge back into — `tickets/**.md` (the potential work,
 * whose file shape is the packaged `ticketing_format.md` spec, #684/#674), the `TODO_AGENTS.md`
 * task queue, and the committed conversations (#683/#908). Repo-root paths, because that is the
 * agent's cwd. README is left out: a repo's own `README.md` already covers the overview. The
 * ticket-format path is inlined rather than imported from `tickets.ts`: this module must stay free
 * of `node:fs` (it renders in the browser, #520), and a test pins the literal to
 * `TICKETING_FORMAT_FILE`. The `TODO_AGENTS.md` format pointer (#880) and the
 * `.the-framework/conversations/` path are inlined for the same reason and pinned by a test.
 */
export const CONTEXT_DOCS: readonly ContextDoc[] = [
  DECISIONS_DOC,
  { path: 'GOAL.md', comment: 'the goal of the project (long-term direction, scope, non-scope, ...)' },
  FACTS_DOC,
  INSIGHTS_DOC,
  // What the market looks like (#694): written by the [Market research] preset and read by the
  // follow-up that turns it into tickets. A pointer the agent reads, not a doc it folds knowledge
  // back into, so it stays out of BUSINESS_KNOWLEDGE_DOCS.
  { path: 'knowledge-base/MARKET_RESEARCH.md', comment: 'the market the project competes in' },
  // The catch-all (#683): any other file the agent parks under knowledge-base/.
  { path: 'knowledge-base/**.md', comment: 'more files holding knowledge related to the project' },
  { path: 'tickets/**.md', comment: 'things to potentially work on; format: node_modules/@gemstack/the-framework/prompts/ticketing_format.md' },
  // Recorded human conversations (#683/#908): the run committed each Discord/chat turn here, so a
  // future agent can read what was said. A read-only pointer, so it stays out of BUSINESS_KNOWLEDGE_DOCS.
  // Path inlined to keep this module node-free; pinned to THE_FRAMEWORK_DIR/CONVERSATIONS_DIR by a test.
  { path: '.the-framework/conversations/**.md', comment: 'recorded human conversations (e.g. via the Discord bot)' },
  { path: 'TODO_AGENTS.md', comment: 'the AI task queue; format: node_modules/@gemstack/the-framework/prompts/todo_format.md' },
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
  /**
   * Transparent mode (#625): drop *everything* framework-authored from the system channel —
   * the built-in prompt, the knowledge docs, AND the emit protocols — so the agent receives an
   * empty system channel, byte-identical to raw `claude -p <prompt>`. This is stronger than
   * `--vanilla` (which keeps the AWAIT/SIGNAL emit contract so the agent can still drive the
   * dashboard's gates); transparent means there is no framework behavior left to signal to.
   * Short-circuits {@link composeRunSystem}, so it overrides every other option here.
   */
  transparent?: boolean | undefined
  /**
   * This run has a real browser attached (#824). Adds the section telling the agent so: the
   * tools are wired through MCP, which the agent discovers, but nothing otherwise says to prefer
   * them — so it reaches for `WebFetch`, and the browser (and its preview) sits unused.
   */
  browser?: boolean | undefined
  /**
   * This is a project-less "topic" run (#1120). Appends {@link TOPIC_BIND_PROTOCOL} so the agent
   * knows it can bind to a project mid-run (#1121). Topic-only: a normal run's channel is unchanged.
   */
  topic?: boolean | undefined
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
  // The context docs ride with the built-in prompt, not with the user's dirs: they are
  // ours, and `--vanilla` means no framework-authored prompt at all (#547 rule 3). They
  // render as commented bullets under the dirs (#559), so the agent sees what each is for.
  // `--vanilla` (antiLazyPill === false) drops both the framework's context docs and its
  // built-in prompt; one boolean drives both so they can't fall out of step.
  const includeBuiltin = opts.antiLazyPill !== false
  const docs = includeBuiltin ? CONTEXT_DOCS : []
  if (dirs.length || docs.length) {
    const head = `Context:${dirs.length ? ` ${dirs.join(', ')}` : ''}`
    const bullets = docs.map(d => `- \`${d.path}\` (${d.comment})`)
    parts.push([head, ...bullets].join('\n'))
  }
  if (includeBuiltin) parts.push(renderSystemPrompt(opts.tf).system)
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
 * first, then the emit protocols. Nothing else is appended — a build run's system channel
 * is exactly this (#547), which is what lets the dashboard show the whole prompt before a run
 * starts (#520). The protocols are otherwise unconditional — they are the *emit contract* (how
 * the agent signals an awaited choice and the setSessionName()/setReadyForMerge() lifecycle),
 * not prompt content — so the agent needs them even with the built-in prompt off (`--vanilla`).
 *
 * The one exception is transparent mode (#625): there is no framework behavior to signal to, so
 * the whole channel is empty and the agent runs as raw `claude -p`.
 */
export function composeRunSystem(opts: RunSystemOptions = {}): string {
  if (opts.transparent) return ''
  const promptBlock = systemPromptBlock(opts)
  // The browser section rides with the protocols, not with the built-in prompt: like them it
  // describes what this run can do, so `--vanilla` (no framework prompt) still gets it — the
  // tools are there either way.
  // Ahead of the protocols, so the signal protocol stays the last thing in the channel (#547).
  const browser = opts.browser ? [BROWSER_PROTOCOL] : []
  // Topic-run bind (#1121): rides with the await protocol (it is an await gate), so it sits right
  // after it and keeps the signal protocol last (#547). Topic-only, so a normal channel is unchanged.
  const topicBind = opts.topic ? [TOPIC_BIND_PROTOCOL] : []
  return [...(promptBlock ? [promptBlock] : []), ...browser, AWAIT_PROTOCOL, ...topicBind, SIGNAL_PROTOCOL].join('\n\n')
}
