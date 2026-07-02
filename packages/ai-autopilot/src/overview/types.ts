import type { LoopEvent } from '../loop/types.js'

/**
 * Scale mode — a compact, always-current map of the codebase the agent reads
 * first before working in a large repo, so it stays oriented without re-scanning
 * the whole tree and blowing the context budget (#114).
 *
 * The artifact is `CODE-OVERVIEW.md`. The hard part is not generating it once but
 * keeping it current: a stale overview is worse than none. So the trigger is a
 * **material-change detector** ({@link detectMaterialChange}) wired into the loop
 * (#113) — the overview refreshes on a build-tool change, a test-framework
 * migration, or a directory restructure, not on every edit and not only
 * on-demand. {@link CodeOverviewMaintainer} owns that policy; the regeneration
 * itself is an injected, agent-backed step so it runs offline against a stub.
 */

/** One titled section of the overview (e.g. Structure, Key modules, Conventions). */
export interface OverviewSection {
  title: string
  body: string
}

/** The parsed `CODE-OVERVIEW.md`: a one-paragraph summary plus titled sections. */
export interface CodeOverview {
  /** What this repo is, in a sentence or two. */
  summary: string
  /** The map: structure, key modules, entry points, conventions, ... */
  sections: OverviewSection[]
}

/** The verdict of the material-change detector. */
export interface MaterialChange {
  /** True when the change is structural enough to warrant refreshing the overview. */
  material: boolean
  /** Why — the concrete signals that fired (empty when not material). */
  reasons: string[]
}

/**
 * The slice of a filesystem the store needs — the same read/write/exists subset
 * as the decisions store, so a booted runner session's `fs` satisfies it and the
 * overview persists inside a sandbox the same way it does on the host.
 */
export interface OverviewFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** What the injected regeneration step receives. */
export interface RegenerateContext {
  /** The current overview, when one exists — to update rather than rewrite blind. */
  previous?: CodeOverview
  /** Why the refresh was triggered (the material-change reasons, or "on-demand"). */
  reason: string
  /** The loop event that triggered it, when driven by the loop. */
  event?: LoopEvent
  signal?: AbortSignal
}

/** Produces a fresh {@link CodeOverview}. Injected so the maintainer runs offline. */
export type Regenerate = (ctx: RegenerateContext) => CodeOverview | Promise<CodeOverview>

/** The outcome of feeding one change to the maintainer. */
export interface OverviewRefresh {
  /** True when the change was material and the overview was regenerated. */
  refreshed: boolean
  /** The material-change reasons (empty when the change was skipped as immaterial). */
  reasons: string[]
  /** The current overview after handling — the fresh one when refreshed, else unchanged. */
  overview?: CodeOverview
}

/** Progress events emitted while the maintainer works (for logging / a surface). */
export type OverviewEvent =
  | { type: 'skip'; event: LoopEvent }
  | { type: 'refresh'; reasons: string[] }
  | { type: 'generated'; reason: string }
