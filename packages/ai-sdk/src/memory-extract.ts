import { z } from 'zod'

import { agent, resolveUserMemory } from './agent.js'
import { Output } from './output.js'
import type {
  AiMessage,
  AiMiddleware,
  MemoryEntry,
  RemembersSpec,
} from './types.js'
import type { UserMemoryLookup } from './memory.js'
import { contentToString } from './util/content.js'

export interface MemoryExtractOptions {
  /**
   * Override the {@link UserMemory} lookup. Defaults to the module-level
   * `resolveUserMemory()` registry that `AiProvider` writes to from
   * `AiConfig.memory`. Tests pass a closure to inject a fake.
   */
  lookup?:      UserMemoryLookup
  /**
   * Confidence floor for the small model's self-rated `score`. Facts
   * with a score < threshold are dropped before any `remember()` call.
   * Default `0.7`.
   *
   * **Tuning note (poisoning mitigation):** the threshold is the v1
   * defense against a malicious user planting adversarial "facts." A
   * low threshold accepts more spam; a high threshold filters useful
   * signal. Pair with `MemoryExtractOptions.onExtracted` for an audit
   * log when you ship extract to production.
   */
  threshold?:   number
  /**
   * Called after a successful extract with the entries that survived
   * the threshold filter and were written to the store. Use this to
   * stream entries into telescope, an audit log, or test assertions.
   */
  onExtracted?: (entries: MemoryEntry[]) => void
  /**
   * Called when extract fails — small-model network error, JSON parse
   * failure, schema-validation rejection, or `mem.remember()` throw.
   * Errors are otherwise swallowed; the parent run never breaks.
   */
  onError?:     (err: unknown) => void
}

/**
 * The shape we ask the small model to fill in when distilling facts.
 * `score` is the model's self-rated confidence in [0, 1]; tags are
 * additive — the spec's `tags` are unioned in regardless.
 */
const ExtractedFactsSchema = z.object({
  facts: z.array(z.object({
    fact:  z.string().min(1),
    score: z.number().min(0).max(1),
    tags:  z.array(z.string()).optional(),
  })),
})

const EXTRACT_INSTRUCTIONS = [
  'You distill durable facts about a USER from a single conversation turn.',
  'A "durable fact" is something true about the user that future conversations would benefit from knowing — preferences, identifying details, ongoing projects, persistent constraints.',
  'Skip anything specific to this conversation, ephemeral state, or already-obvious context.',
  'Self-rate each fact\'s confidence in [0, 1]; the host filters out anything below the threshold.',
  'If nothing is worth remembering, return {"facts": []}.',
].join(' ')

/**
 * Post-conversation {@link AiMiddleware} that asks a small model to
 * distill the latest `[user, assistant]` turn into durable facts and
 * writes the survivors (above `threshold`) to the registered
 * {@link UserMemory}. Auto-installed by `Agent.prompt` /
 * `Agent.stream` when `Agent.remembers().extract === 'auto'` and
 * `extractWith` is set; can also be dropped into `Agent.middleware()`
 * manually.
 *
 * Runs in `onFinish` — only fires on a successful loop, so failed
 * runs don't pollute memory. Failures inside the extract path
 * (network, JSON parse, zod validation, `remember()` throw) are
 * routed through `MemoryExtractOptions.onError` and otherwise
 * swallowed; the parent prompt never breaks because of memory work.
 *
 * **Auto-installed extracts skip continuation calls** (`options.messages`
 * set) at the host level — the same way auto-inject does. Manually
 * installed extracts always run.
 *
 * **Pitfall — memory poisoning:** auto-extraction lets a malicious
 * user plant adversarial "facts." The threshold (default 0.7) is the
 * baseline defense; pair with `onExtracted` for an audit log when you
 * ship to production. A content-filter middleware is a follow-up.
 */
export function withMemoryExtract(
  spec: RemembersSpec,
  opts: MemoryExtractOptions = {},
): AiMiddleware {
  const lookup    = opts.lookup    ?? resolveUserMemory
  const threshold = opts.threshold ?? 0.7
  const wrapper   = Output.object({ schema: ExtractedFactsSchema })

  return {
    name: 'memory-extract',
    async onFinish(ctx) {
      try {
        if (spec.extract !== 'auto') return
        if (!spec.extractWith) return

        const mem = lookup()
        if (!mem) return

        const turn = extractLatestTurn(ctx.messages)
        if (!turn) return

        const extractor = agent({
          instructions: `${EXTRACT_INSTRUCTIONS}\n\n${wrapper.toSystemPrompt()}`,
          model:        spec.extractWith,
        })

        const prompt = [
          `User said: ${JSON.stringify(turn.user)}`,
          `Assistant replied: ${JSON.stringify(turn.assistant)}`,
          '',
          'Extract durable facts about the USER from the above. Return strictly valid JSON.',
        ].join('\n')

        const response = await extractor.prompt(prompt)
        const parsed   = wrapper.parse(response.text)

        const surviving = parsed.facts.filter(f => f.score >= threshold)
        if (surviving.length === 0) {
          opts.onExtracted?.([])
          return
        }

        const tagsFromSpec = spec.tags ?? []
        const written: MemoryEntry[] = []
        for (const f of surviving) {
          const merged = mergeTags(f.tags, tagsFromSpec)
          const entry  = await mem.remember(spec.user, f.fact, {
            score: f.score,
            ...(merged.length > 0 ? { tags: merged } : {}),
          })
          written.push(entry)
        }
        opts.onExtracted?.(written)
      } catch (err) {
        opts.onError?.(err)
        // Never break the parent run.
      }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Walk `messages` from the end and return the most recent
 * `(user, assistant)` pair where the assistant message follows the
 * user message. Skips trailing `tool` messages so multi-step tool
 * loops still surface the original user request and the model's
 * final synthesis.
 *
 * Returns `null` when:
 * - the loop didn't reach a final assistant message (stopped on a
 *   client-tool pause, approval gate, or handoff), or
 * - the assistant message has no extractable text content.
 */
function extractLatestTurn(messages: AiMessage[]): { user: string; assistant: string } | null {
  let assistantText: string | null = null
  let lastAssistantIdx = -1

  // Walk backwards looking for the LAST assistant message that's a
  // text reply (not a tool-calls message).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    if (m.toolCalls && m.toolCalls.length > 0) continue   // tool-call step, not a final reply
    const text = contentToString(m.content, '\n')
    if (text.length === 0) continue
    assistantText  = text
    lastAssistantIdx = i
    break
  }
  if (assistantText === null || lastAssistantIdx === -1) return null

  // Find the most recent user message before that assistant message.
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    const text = contentToString(m.content, '\n')
    if (text.length === 0) continue
    return { user: text, assistant: assistantText }
  }
  return null
}


function mergeTags(modelTags: string[] | undefined, specTags: string[]): string[] {
  if (!modelTags || modelTags.length === 0) return [...specTags]
  if (specTags.length === 0)                 return [...modelTags]
  return Array.from(new Set([...modelTags, ...specTags]))
}
