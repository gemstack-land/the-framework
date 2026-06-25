import { Agent } from '@gemstack/ai-sdk'
import type { AnyTool, AiMiddleware, HasTools, HasMiddleware } from '@gemstack/ai-sdk'
import { composeInstructions, composeTools, composeMiddleware } from './compose.js'
import type { LoadedSkill } from './types.js'

/**
 * An {@link Agent} that composes {@link LoadedSkill}s declaratively.
 *
 * Skills augment the agent; the agent's own declarations stay authoritative.
 * You author your base identity and own tools/middleware in `baseInstructions()`
 * / `baseTools()` / `baseMiddleware()`, and list the skills to compose in
 * `skills()` — mirroring how a plain agent declares `tools()` / `middleware()`.
 *
 * The `instructions()`, `tools()`, and `middleware()` that `@gemstack/ai-sdk`
 * reads are sealed finals here: they merge your `base*` declarations with the
 * skills. **Override the `base*` hooks, not these** — overriding `tools()` or
 * `instructions()` directly drops the skill composition.
 *
 * Skills must be loaded before the agent runs (loading is async — file IO +
 * importing the tools module — while these hooks are synchronous). Load them
 * once at module init and return the loaded objects from `skills()`:
 *
 * ```ts
 * const refunds = await loadSkill('./skills/refunds')
 *
 * class SupportAgent extends SkillfulAgent {
 *   baseInstructions() { return 'You are a support agent.' }
 *   skills()           { return [refunds] }
 *   baseTools()        { return [escalateTool] }   // wins over a same-named skill tool
 * }
 * ```
 */
export abstract class SkillfulAgent extends Agent implements HasTools, HasMiddleware {
  /** Your agent's base identity. Skill instructions are appended after it. */
  abstract baseInstructions(): string

  /** The skills composed onto this agent. Override to declare them. */
  skills(): LoadedSkill[] {
    return []
  }

  /** Your agent's own tools — authoritative on a name collision with a skill tool. */
  baseTools(): AnyTool[] {
    return []
  }

  /** Your agent's own middleware. Runs before any skill-contributed middleware. */
  baseMiddleware(): AiMiddleware[] {
    return []
  }

  // ─── Sealed finals read by @gemstack/ai-sdk — override base* instead ───

  instructions(): string {
    return composeInstructions(this.baseInstructions(), this.skills())
  }

  tools(): AnyTool[] {
    return composeTools(this.baseTools(), this.skills())
  }

  middleware(): AiMiddleware[] {
    return composeMiddleware(this.baseMiddleware(), this.skills())
  }
}
