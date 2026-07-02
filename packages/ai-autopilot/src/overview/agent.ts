import { Output } from '@gemstack/ai-sdk'
import type { Agent } from '@gemstack/ai-sdk'
import { z } from 'zod'
import { definePrompt } from '../loop/define.js'
import type { LoopPrompt } from '../loop/types.js'
import { serializeOverview } from './markdown.js'
import type { CodeOverviewMaintainer } from './maintainer.js'
import type { CodeOverview, Regenerate } from './types.js'

/**
 * The default wirings of scale mode onto the real primitives: an `ai-sdk` agent
 * that regenerates the overview by reading the tree, and a {@link LoopPrompt} that
 * drops the maintainer into the loop (#113) so it self-refreshes on material
 * changes. Both keep the model + runner injected, so the maintainer's policy is
 * tested offline with a stub `regenerate`.
 */

/** Options for {@link agentOverview}. */
export interface AgentOverviewOptions {
  /** Override the instruction the regeneration agent is prompted with. */
  instructions?: string
}

const DEFAULT_OVERVIEW_INSTRUCTIONS = `You maintain CODE-OVERVIEW.md — a compact map of this codebase that another
agent reads first, before working, so it stays oriented without scanning the
whole tree. Read the repository structure with your tools and produce a fresh
overview. Keep it short and current; a stale or bloated overview is worse than
none. Cover: what the repo is (one paragraph), its top-level structure, the key
modules and what each owns, the entry points, and the conventions worth knowing.
When a previous overview is given, update it — keep what still holds, fix what
drifted, and do not pad.`

/**
 * A {@link Regenerate} backed by an `ai-sdk` agent. The agent should carry the
 * tools to read the workspace tree (e.g. `runnerTools(session)`); it is prompted
 * for a structured `{ summary, sections }` overview, with the previous one seeded
 * so it revises rather than rewrites blind.
 */
export function agentOverview(overviewer: Agent, opts: AgentOverviewOptions = {}): Regenerate {
  const schema = z.object({
    summary: z.string().describe('What this repo is, in a sentence or two'),
    sections: z
      .array(z.object({ title: z.string(), body: z.string() }))
      .describe('Titled sections: structure, key modules, entry points, conventions'),
  })
  const output = Output.object({ schema })
  const instructions = opts.instructions ?? DEFAULT_OVERVIEW_INSTRUCTIONS

  return async ctx => {
    const parts = [instructions, `# Why now\n${ctx.reason}`]
    if (ctx.previous) parts.push(`# Current CODE-OVERVIEW.md (update this)\n${serializeOverview(ctx.previous)}`)
    parts.push(output.toSystemPrompt())
    const response = await overviewer.prompt(parts.join('\n\n'))
    return output.parse(response.text ?? '') as CodeOverview
  }
}

/** Options for {@link overviewLoopPrompt}. */
export interface OverviewLoopPromptOptions {
  /** The prompt id the loop references. Default `code-overview`. */
  id?: string
}

/**
 * Bridge a {@link CodeOverviewMaintainer} into a {@link LoopPrompt}, so adding its
 * id to a loop rule (e.g. on `major-change`) makes the overview self-maintain: the
 * loop hands it the event, the maintainer refreshes only if the change is
 * material, and the prompt reports what it did. This is the "regen via the loop"
 * wiring (#113) the issue asks for.
 */
export function overviewLoopPrompt(
  maintainer: CodeOverviewMaintainer,
  opts: OverviewLoopPromptOptions = {},
): LoopPrompt {
  return definePrompt({
    id: opts.id ?? 'code-overview',
    run: async ctx => {
      const refresh = await maintainer.handle(ctx.event)
      return refresh.refreshed
        ? `Refreshed CODE-OVERVIEW.md: ${refresh.reasons.join('; ')}`
        : 'CODE-OVERVIEW.md unchanged (change was not material)'
    },
  })
}
