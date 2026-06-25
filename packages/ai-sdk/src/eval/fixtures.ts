/**
 * Fixture I/O for `pnpm rudder ai:eval --record` / `--replay` (#A5
 * Phase 4). Each case writes one JSON file under
 * `evals/__fixtures__/<suite>/<case>.json` carrying the assistant
 * turns from a real provider run, normalized into the
 * {@link AiFakeStep} shape so `--replay` can re-feed them via
 * `AiFake.respondWithSequence` for zero-API regression tests.
 *
 * The fixture format is versioned. Bumping `version` forces a
 * re-record on stale fixtures rather than silently mis-replaying.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentResponse, ContentPart } from '../types.js'
import type { AiFakeStep } from '../fake.js'

/** Fixture format. Bump `version` when the shape changes incompatibly. */
export interface EvalFixture {
  version:    1
  suite:      string
  case:       string
  input:      string
  recordedAt: string
  steps:      AiFakeStep[]
}

/**
 * Convert an `AgentResponse` into the assistant-turn `AiFakeStep[]`
 * sequence that `AiFake.respondWithSequence` expects.
 *
 * - Drops user/tool turns — those are framework-generated during a
 *   replayed run, not provider output.
 * - Multi-modal assistant content collapses to its concatenated text
 *   parts (the fake's transport is text-only; image/document parts
 *   wouldn't replay meaningfully).
 * - `toolCalls` carry through verbatim so multi-step tool loops
 *   replay deterministically.
 */
export function stepsFromResponse(response: AgentResponse): AiFakeStep[] {
  return response.steps
    .filter(step => step.message.role === 'assistant')
    .map(step => {
      const out: AiFakeStep = {
        text:         contentToText(step.message.content),
        finishReason: step.finishReason,
      }
      if (step.toolCalls.length > 0) out.toolCalls = step.toolCalls
      return out
    })
}

function contentToText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => p.text).join('')
}

// ─── Fixture path conventions ─────────────────────────────

/**
 * Default fixtures directory: `<cwd>/evals/__fixtures__`. Override
 * via the CLI handler's options for tests / non-standard layouts.
 */
export function defaultFixturesDir(cwd: string): string {
  return path.join(cwd, 'evals', '__fixtures__')
}

/**
 * Filesystem-safe slug for `<suite>/<case>` segments. Letters,
 * digits, dot, dash, underscore pass through; everything else
 * collapses to `-`. Multiple consecutive `-` collapse to one.
 *
 * Pure function; tested directly so suite/case rename diffs stay
 * predictable across editors.
 */
export function slugify(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || '_'
}

export function fixturePath(dir: string, suite: string, caseName: string): string {
  return path.join(dir, slugify(suite), `${slugify(caseName)}.json`)
}

// ─── Read / write ─────────────────────────────────────────

/**
 * Read a fixture file. Returns `null` when the fixture is missing
 * (replay falls back to running normally with a clear stderr line).
 *
 * Throws on parse / version errors — corruption is not a passing
 * case and silently ignoring it would mask real regressions.
 */
export async function readFixture(
  dir:      string,
  suite:    string,
  caseName: string,
): Promise<EvalFixture | null> {
  const file = fixturePath(dir, suite, caseName)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const parsed = JSON.parse(raw) as EvalFixture
  if (parsed.version !== 1) {
    throw new Error(
      `[Rudder AI] Fixture ${file} is version ${String(parsed.version)}; expected 1. ` +
      `Re-record with \`pnpm rudder ai:eval --record\`.`,
    )
  }
  return parsed
}

/**
 * Write a fixture, creating intermediate directories as needed.
 * Pretty-printed (2-space) so PR diffs remain readable when the
 * model output evolves.
 */
export async function writeFixture(
  dir:      string,
  suite:    string,
  caseName: string,
  payload:  Omit<EvalFixture, 'version' | 'suite' | 'case' | 'recordedAt'>,
): Promise<string> {
  const file = fixturePath(dir, suite, caseName)
  await mkdir(path.dirname(file), { recursive: true })
  const fixture: EvalFixture = {
    version:    1,
    suite,
    case:       caseName,
    recordedAt: new Date().toISOString(),
    ...payload,
  }
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`)
  return file
}
