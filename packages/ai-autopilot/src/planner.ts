import { Output } from '@gemstack/ai-sdk'
import type { Agent } from '@gemstack/ai-sdk'
import { z } from 'zod'
import type { Planner, Subtask } from './types.js'

/** Default subtask shape an LLM planner emits. */
const defaultSubtaskSchema = z.object({
  description: z.string().describe('What this subtask asks a worker agent to do'),
  worker: z.string().optional().describe('Worker pool key, when routing to named workers'),
})

export interface AgentPlannerOptions {
  /**
   * Zod schema for one subtask. Must produce at least `{ description: string }`
   * (and optionally `worker`). Defaults to that shape.
   */
  element?: z.ZodType
  /** Override the planning instruction prepended to the task. */
  instructions?: string
}

/**
 * Build a {@link Planner} that asks an agent to decompose the task into a JSON
 * array of subtasks, using `@gemstack/ai-sdk`'s `Output.array` for the schema
 * instruction + parsing. The agent is your planning policy; autopilot orchestrates
 * the subtasks it returns.
 */
export function agentPlanner(agent: Agent, opts: AgentPlannerOptions = {}): Planner {
  const element = opts.element ?? defaultSubtaskSchema
  const output = Output.array({ element })
  const instructions = opts.instructions
    ?? 'Break the task below into the smallest set of independent subtasks that can run in parallel. Each subtask is dispatched to a worker agent.'

  return async (task) => {
    const prompt = `${instructions}\n\n# Task\n${task}\n\n${output.toSystemPrompt()}`
    const response = await agent.prompt(prompt)
    return output.parse(response.text ?? '') as Subtask[]
  }
}
