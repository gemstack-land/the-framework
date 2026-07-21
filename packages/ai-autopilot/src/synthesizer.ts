import type { Agent } from '@gemstack/ai-sdk'
import type { Synthesizer, SubtaskResult } from './types.js'

/**
 * The default synthesizer: concatenate the successful results, in plan order,
 * separated by blank lines. No LLM call — deterministic and free. Failed
 * subtasks are omitted; if every subtask failed, the result is an empty string.
 *
 * @example
 * defaultSynthesize('task', [
 *   { ok: true,  text: 'Alpha', ... },
 *   { ok: false, text: '',      ... },
 *   { ok: true,  text: 'Gamma', ... },
 * ])
 * // => "Alpha\n\nGamma"
 */
export function defaultSynthesize(_task: string, results: SubtaskResult[]): string {
  return results
    .filter(r => r.ok)
    .map(r => r.text.trim())
    .filter(s => s.length > 0)
    .join('\n\n')
}

/** Options for {@link agentSynthesizer}. */
export interface AgentSynthesizerOptions {
  /** Override the default "combine, don't concatenate" instruction. */
  instructions?: string
}

/**
 * Build a {@link Synthesizer} that asks an agent to combine the worker results
 * into a single coherent answer. Failed subtasks are omitted from the prompt.
 */
export function agentSynthesizer(agent: Agent, opts: AgentSynthesizerOptions = {}): Synthesizer {
  const instructions = opts.instructions
    ?? 'Combine the worker results below into a single, coherent answer to the task. Resolve overlaps and contradictions; do not just concatenate.'

  return async (task, results) => {
    const ok = results.filter(r => r.ok)
    const body = ok.length > 0
      ? ok.map(r => `## ${r.subtask.description}\n${r.text.trim()}`).join('\n\n')
      : '(no successful worker results)'

    const prompt = `${instructions}\n\n# Task\n${task}\n\n# Worker results\n${body}`
    const response = await agent.prompt(prompt)
    return response.text ?? ''
  }
}
