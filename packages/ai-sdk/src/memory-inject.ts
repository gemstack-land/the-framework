import { resolveUserMemory } from './agent.js'
import type {
  AiMessage,
  AiMiddleware,
  ContentPart,
  MemoryEntry,
  RemembersSpec,
} from './types.js'
import type { UserMemoryLookup } from './memory.js'

export interface MemoryInjectOptions {
  /**
   * Override the {@link UserMemory} lookup. Defaults to the module-level
   * `resolveUserMemory()` registry that `AiProvider` writes to from
   * `AiConfig.memory`. Tests pass a closure to inject a fake.
   */
  lookup?:         UserMemoryLookup
  /**
   * Approximate-tokens estimator used for `injectTokenBudget`. Defaults
   * to `Math.ceil(text.length / 4)` — fine for English-heavy facts; pass
   * a tiktoken-backed estimator if you need accuracy.
   */
  estimateTokens?: (text: string) => number
}

/**
 * Pre-prompt {@link AiMiddleware} that consults a {@link UserMemory}, picks
 * facts relevant to the latest user input, and prepends them to the
 * agent's system message as a fenced `<user-memory>…</user-memory>`
 * block. Auto-installed by `Agent.prompt` / `Agent.stream` when
 * `Agent.remembers()` returns `{ inject: 'auto', … }`; can also be
 * dropped into `Agent.middleware()` manually.
 *
 * Runs in `onStart` (async) — `onConfig` is sync and `recall()` is not.
 * Mutates `ctx.messages[0]` (the system message) in place; the agent
 * loop's `messages` array is the same reference, so the model sees the
 * augmented prompt on the very next provider call.
 *
 * Skips silently when:
 * - no `UserMemory` is registered (lookup returns `undefined`)
 * - no user message exists in `ctx.messages` (continuation flow where
 *   the trailing message is `tool` / `assistant`)
 * - `recall()` returns no facts
 * - the rendered block doesn't fit even one fact under
 *   `spec.injectTokenBudget`
 */
export function withMemoryInject(
  spec: RemembersSpec,
  opts: MemoryInjectOptions = {},
): AiMiddleware {
  const lookup   = opts.lookup         ?? resolveUserMemory
  const estimate = opts.estimateTokens ?? defaultEstimateTokens

  return {
    name: 'memory-inject',
    async onStart(ctx) {
      const userText = findLatestUserText(ctx.messages)
      if (!userText) return

      const mem = lookup()
      if (!mem) return

      const recallOpts: { limit?: number; tags?: string[] } = {}
      if (spec.injectLimit !== undefined) recallOpts.limit = spec.injectLimit
      if (spec.tags        !== undefined) recallOpts.tags  = spec.tags

      const facts = await mem.recall(spec.user, userText, recallOpts)
      if (facts.length === 0) return

      const trimmed = applyTokenBudget(facts, spec.injectTokenBudget, estimate)
      if (trimmed.length === 0) return

      const block = renderMemoryBlock(trimmed)
      const sys   = ctx.messages[0]
      if (!sys || sys.role !== 'system') return

      const original = systemContentToString(sys)
      ctx.messages[0] = { role: 'system', content: `${original}\n\n${block}` }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────

function defaultEstimateTokens(text: string): number {
  // ~4 chars/token works for English; gpt-tokenizer adds a runtime dep
  // we don't want to make mandatory just for a budget approximation.
  return Math.ceil(text.length / 4)
}

/**
 * Walk `messages` from the end and return the text of the most recent
 * `role: 'user'` entry. Returns `null` when:
 * - no user message exists (the loop is in a continuation flow where
 *   `options.messages` was passed and ends with `tool`/`assistant`), or
 * - the user message has only non-text content parts.
 *
 * The rationale for "latest user" rather than "all user history": the
 * search query that maps best to recall accuracy is the user's current
 * request. Earlier turns already shaped the loaded conversation
 * history, which the persistence layer handles separately.
 */
function findLatestUserText(messages: AiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'user') {
      const text = userContentToString(m)
      return text.length > 0 ? text : null
    }
  }
  return null
}

function userContentToString(m: AiMessage): string {
  if (typeof m.content === 'string') return m.content
  return contentPartsToString(m.content)
}

function systemContentToString(m: AiMessage): string {
  if (typeof m.content === 'string') return m.content
  return contentPartsToString(m.content)
}

function contentPartsToString(parts: ContentPart[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string') out.push(p.text)
  }
  return out.join('\n')
}

/**
 * If `budget` is set, sort facts by score descending (undefined scores
 * treated as 0.5 — neutral) and accumulate until the rendered block's
 * estimated tokens would exceed `budget`. Returns the accepted prefix.
 *
 * If `budget` is unset, returns `facts` unchanged.
 */
function applyTokenBudget(
  facts:     MemoryEntry[],
  budget:    number | undefined,
  estimate:  (text: string) => number,
): MemoryEntry[] {
  if (budget === undefined || budget <= 0) return facts

  // Sort by score desc; undefined → 0.5 so user-asserted facts (no
  // score) tie with mid-confidence model-extracted facts.
  const sorted = [...facts].sort((a, b) => (b.score ?? 0.5) - (a.score ?? 0.5))

  // Render incrementally to account for the wrapper overhead.
  const accepted: MemoryEntry[] = []
  for (const f of sorted) {
    const candidate = renderMemoryBlock([...accepted, f])
    if (estimate(candidate) > budget) break
    accepted.push(f)
  }
  return accepted
}

/**
 * Render the prepended block. The fenced `<user-memory>` tag gives
 * downstream systems (telescope, evals, screenshots) a stable hook to
 * detect / strip injected memory, and signals the model that the
 * content is provided by the framework rather than written into the
 * agent's instructions.
 */
function renderMemoryBlock(facts: MemoryEntry[]): string {
  const lines = facts.map(f => `- ${f.fact}`)
  return `<user-memory>\n${lines.join('\n')}\n</user-memory>`
}
