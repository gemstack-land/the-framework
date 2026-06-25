/**
 * AI agent event observers — process-wide pub/sub for agent executions
 * made through `@gemstack/ai-sdk`. Any package can subscribe to be notified
 * about completed or failed agent runs.
 *
 * Used today by `@rudderjs/telescope`'s AiCollector to record agent
 * executions into the dashboard. The registry is defined here (inside
 * `@gemstack/ai-sdk`) so the observer contract lives with the package that
 * owns the AI abstraction.
 */

// ─── Event Types ──────────────────────────────────────────

export interface AiObserverToolCall {
  id:            string
  name:          string
  args:          unknown
  result:        unknown
  duration:      number
  needsApproval: boolean
}

export interface AiObserverStep {
  iteration:    number
  model:        string
  tokens:       { prompt: number; completion: number; total: number }
  finishReason: string
  toolCalls:    AiObserverToolCall[]
}

/** Discriminated union of every event the AI agent loop can emit. */
export type AiEvent =
  | {
      kind:             'agent.completed'
      agentName:        string
      model:            string
      provider:         string
      input:            string
      output:           string
      steps:            AiObserverStep[]
      tokens:           { prompt: number; completion: number; total: number }
      duration:         number
      finishReason:     string
      streaming:        boolean
      conversationId:   string | null
      failoverAttempts: number
    }
  | {
      kind:             'agent.failed'
      agentName:        string
      model:            string
      provider:         string
      input:            string
      output:           string
      steps:            AiObserverStep[]
      tokens:           { prompt: number; completion: number; total: number }
      duration:         number
      finishReason:     string
      streaming:        boolean
      conversationId:   string | null
      failoverAttempts: number
      error:            string
    }
  | {
      /**
       * Emitted after each iteration of the agent loop, before the next
       * provider call (or before the loop exits). Lets observers report
       * incremental progress — token usage so far, tools called this step
       * — without waiting for the full run to finish. Fires for every step
       * in both `prompt()` and `stream()` runs.
       */
      kind:           'agent.step.completed'
      agentName:      string
      model:          string
      provider:       string
      iteration:      number
      step:           AiObserverStep
      /** Cumulative usage across all completed steps. */
      tokens:         { prompt: number; completion: number; total: number }
      /** Cumulative wall-clock ms since the loop started. */
      duration:       number
      streaming:      boolean
      conversationId: string | null
    }
  | {
      /**
       * Emitted by the eval framework runner (`@gemstack/ai-sdk/eval`) after
       * each case completes — passing, failing, or skipped. Telescope's
       * AI collector aggregates pass-rate over time per `(suite, case)`
       * pair (#A5 Phase 4).
       *
       * Skipped cases still emit so the dashboard shows coverage gaps.
       * `score` is present for graded metrics (semanticMatch, llmJudge);
       * absent for binary metrics (exactMatch, regex). `reason` is the
       * failure / skip explanation when present.
       */
      kind:     'agent.eval.completed'
      suite:    string
      case:     string
      status:   'passed' | 'failed' | 'skipped'
      pass:     boolean
      score?:   number
      reason?:  string
      tokens:   number
      cost:     number
      duration: number
    }

export type AiObserver = (event: AiEvent) => void

export class AiObserverRegistry {
  private observers: AiObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: AiObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by `runAgentLoop()` / `runAgentLoopStreaming()` after each
   * agent execution. Errors thrown by observers are swallowed —
   * observability must never break agent runs.
   */
  emit(event: AiEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break agents */ }
    }
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like `httpObservers` in `@rudderjs/http`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_ai_observers__']) {
  _g['__rudderjs_ai_observers__'] = new AiObserverRegistry()
}

export const aiObservers = _g['__rudderjs_ai_observers__'] as AiObserverRegistry
