import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderTemplate } from './prompt-template.js'

/**
 * Rom's system prompt (#326), verbatim, as a template. It supersedes the
 * anti-lazy-pill (#297/#301) it grew out of: unclear scope becomes a ranked
 * `showChoices()` list, a large scope becomes a PLAN file to approve, a very
 * large one also spins off a TODO backlog (consumed by the backlog loop, #323),
 * the alternatives flow rates problem "variability" before code is written, and
 * the maintenance section keeps edits minimal.
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
 * Keep this byte-identical to the #326 issue text (it is Rom's living doc);
 * change it there first.
 */
export const SYSTEM_PROMPT_TEMPLATE = `# System prompt

SHOW_MD: Show it to the user via \`showMarkdown()\`
SHOW_CHOICES: Show it to the user via \`showChoices()\`
AWAIT: Stop, await user answer before resuming
SESSION_NAME: the name of the current Git branch — sanitize it to be a SLUG, if name is generic (e.g. \`main\`) then create a succinct SLUG
SLUG: [a-z0-9-]+
TODO_FILE: \`TODO_<SESSION_NAME>.agent.md\`

## Unclear scope

If it isn't clear what you should do (e.g. unclear scope, unclear user prompt), make a list of interpretations sorted by plausibility, <SHOW_CHOICES>, <AWAIT>

## Large scope

- If the scope of what you'll work on is *large*, create a \`PLAN_<SESSION_NAME>.agent.md\` of what you'll work on, <SHOW_MD>, <AWAIT>
- If the scope is potentially *very large* (e.g. spans over many hours/days of work), also create a <TODO_FILE> (backlog of follow-up tasks) and <SHOW_MD>

## Alternatives

Before starting to write code, measure "variability":
- List all high-level problems that need to be implemented
- Give a rating for each problem (from 0 to 10) following this criteria: is there an obviously optimal way to solve the problem (10), or is it highly unclear whether the problem can be solved in a better way (0)?
- Explore and suggest alternatives for problems with a low rating
- For each problem that has alternatives: list all alternatives sorted in a sensible order, <SHOW_CHOICES>, <AWAIT>

## Maintenance

- When making changes to existing code, \${{ tf.params.autopilot ? "you can prefer minimal changes (e.g. to postpone a deep refactor)" : "prefer minimal changes to make it easier for humans to read the changes" }}
- But your changes should still be the correct solution on a high-level, don't implement a bad solution for the sake of making minimal changes
- If your changes aren't trivial and leads to refactor potential, add a new entry to <TODO_FILE>
  - The entry: "Look for refactoring opportunities arising from the <SESSION_NAME> merge"

# User prompt

\${{tf.prompt}}`

/**
 * Eco fine-grained control (#314): each flag drops one whole `##` section from the
 * built-in #326 prompt to save tokens, letting the agent auto-handle that concern.
 * The template itself stays byte-identical to Rom's #326 doc; the sections are
 * removed after the split, so a dropped section never leaves a fragment behind.
 */
export interface EcoOptions {
  /** Drop `## Large scope` (the PLAN-file planning section). */
  autoPlanning?: boolean | undefined
  /** Drop `## Alternatives` (the variability-rating research section). */
  autoResearch?: boolean | undefined
  /** Drop `## Maintenance` (the minimal-changes maintenance section). */
  autoMaintenance?: boolean | undefined
}

/** Maps an {@link EcoOptions} flag to the `## ` heading it drops from the template. */
const ECO_SECTION_HEADINGS: Record<keyof EcoOptions, string> = {
  autoPlanning: '## Large scope',
  autoResearch: '## Alternatives',
  autoMaintenance: '## Maintenance',
}

/** The `tf` context the template's `${{...}}` fragments read (#326/#350). */
export interface TfContext {
  /** The user's prompt (the run intent, or the typed prompt): fills `${{tf.prompt}}`. */
  prompt: string
  /** Run parameters the template branches on (e.g. `autopilot`, #325's mode sense; `eco`, #314). */
  params: { autopilot?: boolean; eco?: EcoOptions | undefined } & Record<string, unknown>
}

/** The neutral context used when a caller has none: empty prompt, no modes. */
const DEFAULT_TF: TfContext = { prompt: '', params: {} }

/** The two halves of the rendered {@link SYSTEM_PROMPT_TEMPLATE}. */
export interface RenderedSystemPrompt {
  /** The `# System prompt` half: frames the session's system channel. */
  system: string
  /** The `# User prompt` half: the rendered user-prompt slot (`${{tf.prompt}}` plus any framing Rom adds around it). */
  user: string
}

const USER_PROMPT_HEADING = '\n# User prompt\n'

/**
 * Drop a whole `## <heading>` section from a markdown block: everything from the
 * heading up to (but not including) the next `## ` heading, or the end. The `\n\n`
 * separator ahead of the section goes with it, so the surrounding blocks stay
 * spaced exactly as before. A heading that isn't present is a no-op.
 */
function dropSection(md: string, heading: string): string {
  const at = md.indexOf(`\n${heading}`)
  if (at === -1) return md
  const nextHeading = md.indexOf('\n## ', at + heading.length + 1)
  const end = nextHeading === -1 ? md.length : nextHeading
  return md.slice(0, at) + md.slice(end)
}

/** Remove each Eco-enabled section from the template's system half (#314). */
function applyEco(systemHalf: string, eco: EcoOptions | undefined): string {
  if (!eco) return systemHalf
  let out = systemHalf
  for (const key of Object.keys(ECO_SECTION_HEADINGS) as (keyof EcoOptions)[]) {
    if (eco[key]) out = dropSection(out, ECO_SECTION_HEADINGS[key])
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
export const SYSTEM_PROMPT_FILE = 'SYSTEM.md'

/**
 * Read the user's system prompt from {@link SYSTEM_PROMPT_FILE} at the workspace
 * root. Returns `undefined` when the file is absent or empty, so the caller falls
 * back to the built-in default alone.
 */
export async function loadUserSystemPrompt(
  dir: string,
  file: string = SYSTEM_PROMPT_FILE,
): Promise<string | undefined> {
  try {
    const content = (await readFile(join(dir, file), 'utf8')).trim()
    return content || undefined
  } catch {
    return undefined
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
  if (opts.antiLazyPill !== false) parts.push(renderSystemPrompt(opts.tf).system)
  const user = opts.user?.trim()
  if (user) parts.push(user)
  return parts.join('\n\n')
}
