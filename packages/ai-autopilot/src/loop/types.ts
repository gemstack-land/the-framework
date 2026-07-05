import type { DecisionLedger } from '../decisions/ledger.js'
import type { Verdict } from './verdict.js'

/**
 * "The loop" — the event-to-prompt-chain policy. When the agent does something
 * of a given *kind*, the right follow-up prompts fire automatically: a major
 * change runs review + code-quality + security; a new UI flow runs QA + UX.
 *
 * This is the web-app-specific orchestration layer generic harnesses do not
 * have. It is semantic (a *kind* of change selects a *set* of prompts), not
 * command-driven or run-on-every-PR. The trigger is a {@link LoopEvent} the
 * agent declares; a {@link Loop} maps its kind to an ordered chain of
 * {@link LoopPrompt}s; the {@link LoopEngine} runs them (N fresh-context passes each)
 * and can consult the decisions ledger along the way.
 */

/**
 * A semantic trigger the agent declares after doing work — the input to the
 * loop. `kind` selects which loops fire (e.g. `major-change`, `ui-flow`); the
 * rest is context handed to the prompts that run.
 */
export interface LoopEvent {
  /** The semantic change type; matched against {@link Loop.on}. */
  kind: string
  /** One-line description of what happened, for the prompts that run. */
  summary?: string
  /** Files the change touched, so a prompt can scope its work. */
  paths?: readonly string[]
  /** Anything else a prompt might use. */
  meta?: Readonly<Record<string, unknown>>
}

/**
 * What a {@link LoopPrompt} receives on each pass. `pass` is 1-based; the prompt
 * builds a *fresh* context each time it is invoked (see {@link LoopPrompt.run}).
 * `ledger`, when the loop has one, lets a prompt consult prior decisions.
 */
export interface LoopContext {
  event: LoopEvent
  pass: number
  passes: number
  ledger?: DecisionLedger
}

/**
 * One unit of follow-up work in a chain (review, code-quality, security, ...).
 *
 * A prompt is *data* plus a `run` thunk. The loop calls `run` once per pass and
 * takes its text; running a prompt across a few passes with **fresh context each
 * time** improves the result, so `run` is expected to build a new agent/run per
 * invocation rather than carry state across passes.
 */
export interface LoopPrompt {
  /** Stable id, kebab-case; referenced by {@link Loop.run}. */
  readonly id: string
  /** Number of fresh-context passes to run. Positive integer; default 1. */
  readonly passes: number
  /** Produce this pass's result. Build fresh context each call. */
  run(ctx: LoopContext): string | Promise<string>
}

/** Author-facing shape for {@link definePrompt}; `passes` defaults to 1. */
export interface LoopPromptSpec {
  id: string
  passes?: number
  run(ctx: LoopContext): string | Promise<string>
}

/**
 * A policy loop: when an event of one of `on`'s kinds fires, run the prompts in
 * `run`, in order (a chain). Multiple loops can match one event; their prompt
 * ids are concatenated in loop order and de-duped.
 */
export interface Loop {
  readonly on: readonly string[]
  readonly run: readonly string[]
}

/** Author-facing shape for {@link defineLoop}; `on` may be a single kind. */
export interface LoopSpec {
  on: string | string[]
  run: string[]
}

/** The outcome of one pass of a prompt. */
export interface PassResult {
  pass: number
  /** The pass's text; empty when the pass failed. */
  text: string
  ok: boolean
  /** The failure, when `ok` is false. */
  error?: unknown
}

/** The outcome of running one prompt (all its passes). */
export interface PromptOutcome {
  promptId: string
  passes: PassResult[]
  /** True when the final pass succeeded (executed without throwing). */
  ok: boolean
  /**
   * The structured verdict parsed from the final pass, when the loop has a
   * `verdict` parser and the prompt returned one. Absent otherwise.
   */
  verdict?: Verdict
  /**
   * The gating result: executed cleanly *and*, when a verdict was parsed, has no
   * blockers. Equals {@link ok} when no verdict parser is configured, so the gate
   * is backward-compatible. This is what `continueOnError: false` stops on.
   */
  passing: boolean
}

/** The full result of handling one {@link LoopEvent}. */
export interface LoopRunResult {
  event: LoopEvent
  /** False when no loop matched the event's kind (nothing ran). */
  matched: boolean
  /** One entry per dispatched prompt, in chain order. */
  outcomes: PromptOutcome[]
}

/** Progress events emitted while the loop runs (for logging / a surface). */
export type LoopProgress =
  | { type: 'match'; event: LoopEvent; prompts: string[] }
  | { type: 'no-match'; event: LoopEvent }
  | { type: 'unknown-prompt'; promptId: string }
  | { type: 'prompt-start'; promptId: string; passes: number }
  | { type: 'pass'; promptId: string; result: PassResult; passes: number }
  | { type: 'prompt-done'; promptId: string; ok: boolean; passing: boolean; verdict?: Verdict }
  | { type: 'gate-stop'; promptId: string }
  | { type: 'done'; event: LoopEvent; outcomes: PromptOutcome[] }
