/**
 * `@gemstack/ai-sdk/chat-mentions` - parse `@<slug>` agent mentions out of a chat
 * message and turn them into an orchestrator routing rule.
 *
 * A chat UX where the user types `@<slug>` to explicitly invoke an agent
 * (overriding the orchestrator's own routing judgment) is generic: chat
 * panels, Slack/Discord bots, CLIs. This ships the two reusable pieces every
 * such consumer would otherwise hand-roll:
 *
 * - {@link parseMentions} extracts and validates the tokens, returning the
 *   matched slugs plus the message with the tokens stripped.
 * - {@link buildMentionRoutingRule} renders a system-prompt rule that forces
 *   the orchestrator to dispatch the mentioned agents in order.
 *
 * Token shape: `@<slug>` where `<slug>` matches `[a-z0-9-]+`. A whitespace (or
 * start-of-string) is required before the `@` so `email@host` is not parsed as
 * a mention, and the right side is bounded by a non-word boundary so
 * `@seo-assistant.` does not eat the trailing punctuation.
 */

/** Global regex matching an `@<slug>` mention with its leading boundary. */
export const MENTION_REGEX = /(^|\s)@([a-z0-9-]+)(?=$|[^\w-])/gi

export interface ParsedMentions {
  /** Slugs found in the message, lower-cased, in first-seen order, deduplicated. */
  slugs:   string[]
  /** The message with every recognized `@<slug>` token removed and whitespace collapsed. */
  cleaned: string
}

/**
 * Parse `@<slug>` mentions from a message and validate them against a set of
 * known agent slugs. Unknown mentions (e.g. `@nope`) are left in the message
 * verbatim - they are plain text, not a routing signal. Matched tokens are
 * stripped and surrounding whitespace is collapsed, so the model sees only the
 * cleaned intent.
 *
 * `knownSlugs` accepts any iterable (array or `Set`); matching is
 * case-insensitive and the returned slugs are lower-cased.
 */
export function parseMentions(message: string, knownSlugs: Iterable<string>): ParsedMentions {
  const known = new Set<string>()
  for (const s of knownSlugs) known.add(s.toLowerCase())

  const seen = new Set<string>()
  const slugs: string[] = []

  // Fresh regex instance so a shared `MENTION_REGEX.lastIndex` can never leak
  // across calls (the exported constant is global).
  const re = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags)

  const cleaned = message
    .replace(re, (full, lead: string, slug: string) => {
      const lower = slug.toLowerCase()
      if (!known.has(lower)) return full   // unknown slug - leave intact
      if (!seen.has(lower)) {
        seen.add(lower)
        slugs.push(lower)
      }
      return lead === '' ? '' : ' '
    })
    .replace(/\s{2,}/g, ' ')
    .trim()

  return { slugs, cleaned }
}

export interface MentionRoutingRuleOptions {
  /**
   * Name of the tool the orchestrator calls to dispatch an agent.
   * Default `'run_agent'`.
   */
  toolName?: string
  /**
   * The argument key on that tool carrying the agent slug.
   * Default `'agentSlug'`.
   */
  argKey?:   string
}

/**
 * Build the system-prompt rule injected when a message carries one or more
 * validated mentions. The orchestrator is instructed to call the dispatch
 * tool (default `run_agent({ agentSlug })`) for each mentioned agent in order,
 * overriding its own routing decision. Returns `null` when `slugs` is empty so
 * callers can `if (rule) systemPrompt += rule` without a length check.
 */
export function buildMentionRoutingRule(
  slugs: readonly string[],
  opts:  MentionRoutingRuleOptions = {},
): string | null {
  if (slugs.length === 0) return null

  const toolName = opts.toolName ?? 'run_agent'
  const argKey   = opts.argKey   ?? 'agentSlug'

  if (slugs.length === 1) {
    const slug = slugs[0]!
    return [
      '## @-mention routing (HARD RULE)',
      `The user explicitly invoked agent \`${slug}\` via @-mention. You MUST call \`${toolName}({ ${argKey}: "${slug}" })\` immediately with the user's request, regardless of how well the request matches that agent. Do not ask clarifying questions. Do not call other tools first. The mention has already been validated by the server.`,
    ].join('\n')
  }

  const list = slugs.map((s) => `\`${s}\``).join(', ')
  return [
    '## @-mention routing (HARD RULE)',
    `The user explicitly invoked these agents via @-mention, in order: ${list}. You MUST call \`${toolName}\` for each one in turn (passing its slug as \`${argKey}\`), passing the user's request as input. Do not ask clarifying questions between mentions. Do not call other tools first. The mentions have already been validated by the server.`,
  ].join('\n')
}
