import { agent } from '@gemstack/ai-sdk'
import type { Agent, AnyTool } from '@gemstack/ai-sdk'
import { composeInstructions, composeTools, composeMiddleware } from '@gemstack/ai-skills'
import type { Persona } from './types.js'

/**
 * The full instructions a persona contributes: its `systemPrompt` first
 * (authoritative), then each skill's body under a `# Skill:` header. Reuses the
 * `@gemstack/ai-skills` composition so a persona layers skills exactly like a
 * `SkillfulAgent` does.
 */
export function personaInstructions(persona: Persona): string {
  return composeInstructions(persona.systemPrompt, [...persona.skills])
}

/**
 * The persona's own tools unioned with its skills' tools. The persona's own
 * tools win a name collision; a colliding skill tool is namespaced, never
 * dropped (see `composeTools`).
 */
export function personaTools(persona: Persona): AnyTool[] {
  return composeTools([...persona.tools], [...persona.skills])
}

/** Options for materializing a persona into a runnable agent. */
export interface PersonaAgentOptions {
  /** Model string (e.g. `anthropic/claude-sonnet-4-5`). Omit to use the agent default. */
  model?: string
}

/**
 * Materialize a persona into a runnable `ai-sdk` {@link Agent}: its composed
 * instructions, tools, and any skill middleware. Kept separate from the persona
 * data so the same persona can be inspected or listed without building an agent.
 */
export function personaAgent(persona: Persona, opts: PersonaAgentOptions = {}): Agent {
  return agent({
    instructions: personaInstructions(persona),
    tools: personaTools(persona),
    middleware: composeMiddleware([], [...persona.skills]),
    model: opts.model,
  })
}

/**
 * Build a `Record<string, Agent>` keyed by persona name, ready to drop into
 * `Supervisor`'s `workers` option so a plan's `subtask.worker` routes to the
 * right persona.
 *
 * @throws if two personas share a name (the key would collide silently).
 */
export function personaWorkers(
  personas: readonly Persona[],
  opts: PersonaAgentOptions = {},
): Record<string, Agent> {
  const workers: Record<string, Agent> = {}
  for (const persona of personas) {
    if (persona.name in workers) {
      throw new Error(`[ai-autopilot] duplicate persona name in workers: "${persona.name}"`)
    }
    workers[persona.name] = personaAgent(persona, opts)
  }
  return workers
}

/**
 * A planner-facing prompt fragment listing the available personas by name and
 * role. Inject it into a planning agent's instructions so it decomposes a task
 * into subtasks tagged with the `worker` that should run each one — the bridge
 * that makes the Supervisor's plan stack-aware.
 */
export function personaRoster(personas: readonly Persona[]): string {
  if (personas.length === 0) return 'No personas are available.'
  const lines = personas.map(p => `- \`${p.name}\` — ${p.role}`)
  return [
    'Available personas (route each subtask to one by setting its `worker` to the persona name):',
    ...lines,
  ].join('\n')
}
