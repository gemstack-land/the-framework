import type { DecisionLedger } from '../decisions/ledger.js'
import type {
  LoopEvent,
  LoopProgress,
  LoopPrompt,
  Loop,
  LoopRunResult,
  PassResult,
  PromptOutcome,
} from './types.js'
import type { Verdict } from './verdict.js'
import { parseVerdict } from './verdict.js'
import { makeEmitter } from '../util/emitter.js'

/** Options for {@link LoopEngine}. */
export interface LoopEngineOptions {
  /** The policy: which prompt chains fire for which event kinds. */
  loops: Loop[]
  /** The prompts a loop can reference, as a list or a map keyed by id. */
  prompts: LoopPrompt[] | Record<string, LoopPrompt>
  /** Consulted by prompts (exposed on {@link LoopContext.ledger}). Optional. */
  ledger?: DecisionLedger
  /**
   * Failure policy, the sync-vs-async knob:
   * - `true` (default) — fire-and-report: every matched prompt runs regardless
   *   of a prior one failing.
   * - `false` — blocking gate: if a prompt does not *pass*, stop the chain (a
   *   `gate-stop` event); the remaining prompts do not run. "Pass" means the
   *   final pass executed and, when a {@link LoopEngineOptions.verdict} parser is set,
   *   returned no blockers.
   */
  continueOnError?: boolean
  /**
   * Parse a prompt's final-pass text into a {@link Verdict}. When set, the loop
   * gates on the *outcome* a prompt reports (`{ blockers }`), not just whether it
   * executed — a prompt that runs but returns blockers is not passing. Defaults
   * to {@link parseVerdict} (reads a fenced ```json `{ "blockers": [...] }`).
   * Pass `null` to disable verdict gating entirely (execution-only gate).
   */
  verdict?: ((text: string) => Verdict | undefined) | null
  /**
   * Observe progress. Isolated: a throwing callback is logged and swallowed, so
   * an observer bug cannot abort a run.
   */
  onEvent?: (event: LoopProgress) => void
}

/**
 * The loop engine. Give it a policy ({@link Loop}s) and a set of
 * {@link LoopPrompt}s; call {@link handle} with a {@link LoopEvent} the agent
 * declared and it runs the matching prompt chain (each prompt for its
 * fresh-context passes), consulting the decisions ledger when one is set.
 *
 * ```ts
 * const loop = new LoopEngine({ loops: defaultLoops(), prompts: [reviewPrompt, ...] })
 * await loop.handle({ kind: 'major-change', summary: 'reworked auth', paths: ['src/auth/*'] })
 * ```
 *
 * `handle` awaits the whole chain (the synchronous story); for fire-and-report
 * over a stream of events, feed them through {@link watch}, or run `handle`
 * inside `launchAutopilot` for a detached background run.
 */
export class LoopEngine {
  private readonly loops: Loop[]
  private readonly prompts: Map<string, LoopPrompt>
  private readonly ledger?: DecisionLedger
  private readonly continueOnError: boolean
  private readonly parseVerdict: ((text: string) => Verdict | undefined) | null
  private readonly emit: (event: LoopProgress) => void

  constructor(opts: LoopEngineOptions) {
    if (!Array.isArray(opts?.loops)) throw new TypeError('[ai-autopilot] LoopEngine requires `loops`')
    if (opts.prompts == null) throw new TypeError('[ai-autopilot] LoopEngine requires `prompts`')

    this.loops = opts.loops
    this.prompts = indexPrompts(opts.prompts)
    if (opts.ledger !== undefined) this.ledger = opts.ledger
    this.continueOnError = opts.continueOnError ?? true
    this.parseVerdict = opts.verdict === undefined ? parseVerdict : opts.verdict
    this.emit = makeEmitter(opts.onEvent)
  }

  /**
   * The prompt ids that would fire for `event`, in chain order and de-duped
   * across all matching loops. Pure — no prompts run.
   */
  matches(event: LoopEvent): string[] {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const loop of this.loops) {
      if (!loop.on.includes(event.kind)) continue
      for (const id of loop.run) {
        if (seen.has(id)) continue
        seen.add(id)
        ids.push(id)
      }
    }
    return ids
  }

  /** Run the prompt chain matching `event`. Resolves when the chain is done. */
  async handle(event: LoopEvent): Promise<LoopRunResult> {
    const ids = this.matches(event)
    if (ids.length === 0) {
      this.emit({ type: 'no-match', event })
      return { event, matched: false, outcomes: [] }
    }
    this.emit({ type: 'match', event, prompts: ids })

    const outcomes: PromptOutcome[] = []
    for (const id of ids) {
      const prompt = this.prompts.get(id)
      if (!prompt) {
        this.emit({ type: 'unknown-prompt', promptId: id })
        outcomes.push({ promptId: id, passes: [], ok: false, passing: false })
        // A missing prompt is a non-passing outcome like any other: it must not
        // slip past a blocking gate that a throwing prompt would have stopped.
        if (!this.continueOnError) {
          this.emit({ type: 'gate-stop', promptId: id })
          break
        }
        continue
      }

      const outcome = await this.runPrompt(prompt, event)
      outcomes.push(outcome)

      if (!outcome.passing && !this.continueOnError) {
        this.emit({ type: 'gate-stop', promptId: id })
        break
      }
    }

    this.emit({ type: 'done', event, outcomes })
    return { event, matched: true, outcomes }
  }

  /**
   * Consume a stream of events, handling each in turn (fire-and-report). Returns
   * one {@link LoopRunResult} per event. Sequential so the surface sees an
   * ordered narrative; wrap in `launchAutopilot` if you need it detached.
   */
  async watch(events: AsyncIterable<LoopEvent> | Iterable<LoopEvent>): Promise<LoopRunResult[]> {
    const results: LoopRunResult[] = []
    for await (const event of events as AsyncIterable<LoopEvent>) {
      results.push(await this.handle(event))
    }
    return results
  }

  private async runPrompt(prompt: LoopPrompt, event: LoopEvent): Promise<PromptOutcome> {
    this.emit({ type: 'prompt-start', promptId: prompt.id, passes: prompt.passes })
    const passes: PassResult[] = []

    // N passes, fresh context each: a new LoopContext per invocation and no
    // state carried between them, so the prompt re-derives its answer each time.
    for (let pass = 1; pass <= prompt.passes; pass++) {
      const ctx = { event, pass, passes: prompt.passes, ...(this.ledger ? { ledger: this.ledger } : {}) }
      let result: PassResult
      try {
        result = { pass, text: await prompt.run(ctx), ok: true }
      } catch (error) {
        result = { pass, text: '', ok: false, error }
      }
      passes.push(result)
      this.emit({ type: 'pass', promptId: prompt.id, result, passes: prompt.passes })
    }

    const last = passes[passes.length - 1]
    const ok = last?.ok ?? false
    // A verdict only means something when the pass that produced it executed.
    const verdict = ok && this.parseVerdict ? this.parseVerdict(last!.text) : undefined
    const passing = ok && (verdict ? verdict.blockers.length === 0 : true)

    this.emit({ type: 'prompt-done', promptId: prompt.id, ok, passing, ...(verdict ? { verdict } : {}) })
    return { promptId: prompt.id, passes, ok, passing, ...(verdict ? { verdict } : {}) }
  }
}

/** Factory mirror of `new LoopEngine(...)`. */
export function createLoopEngine(opts: LoopEngineOptions): LoopEngine {
  return new LoopEngine(opts)
}

// ─── Internals ───────────────────────────────────────────────────

function indexPrompts(prompts: LoopPrompt[] | Record<string, LoopPrompt>): Map<string, LoopPrompt> {
  const list = Array.isArray(prompts) ? prompts : Object.values(prompts)
  const map = new Map<string, LoopPrompt>()
  for (const p of list) map.set(p.id, p)
  return map
}

