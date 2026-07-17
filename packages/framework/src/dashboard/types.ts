import type { EcoOptions } from '../system-prompt.js'

// The dashboard's request/result vocabulary (#345/#396/#475): the shapes the Start / Add /
// Preview RPCs speak. They live here, on neither the HTTP server nor the Telefunc mount, so
// both — plus the telefunctions themselves — depend on this leaf rather than on each other.

/** The outcome of an add-project attempt (#396). */
export type AddProjectResult =
  | { ok: true; added: number; alreadyActivated: number }
  | { ok: false; error: string }

/**
 * The dashboard's Global options (#314), posted alongside a Start. Each maps to a
 * run flag: Autopilot + Technical to modes, Vanilla to removing the built-in
 * system prompt, and Eco to the fine-grained #326 section drops. Absent fields
 * default off, i.e. today's behavior.
 */
export interface StartRunOptions {
  /** Auto-accept mode; also steers the #326 maintenance stance. */
  autopilot?: boolean
  /** Technical mode: expose technical detail (preset-scoped). */
  technical?: boolean
  /** Remove the built-in #326 system prompt entirely (raw Claude Code). */
  vanilla?: boolean
  /** Fine-grained #326 section drops to save tokens. */
  eco?: EcoOptions
  /** In-context directories (#439): each becomes a `--context <dir>` flag on the spawned run. */
  context?: string[]
  /** On-before-mergeable prompt (#326): on setReadyForMerge(), queue the quality follow-ups as TODO entries; maps to `--on-before-mergeable`. */
  onBeforeMergeable?: boolean
  /** Give the agent a real browser via chrome-devtools-mcp during the run (#452); maps to `--browser`. */
  browser?: boolean
  /** The model to run the wrapped agent on (#628); maps to `--model`. Absent = the driver's own default. */
  model?: string
}

/**
 * What a dashboard Start spawns (#345/#331/#353): `build` is the normal framework
 * run; `prompt` runs the posted text verbatim through the direct path — what the
 * page sends after a preset prefilled (and the user possibly edited) the textarea;
 * `research` renders the [Research] preset around the posted "what" server-side
 * (empty allowed, defaults to `this PR`) and remains for API callers.
 */
export type StartRunKind = 'build' | 'research' | 'prompt'

/** The outcome of a Start attempt (#345). */
export type StartRunResult =
  | { ok: true }
  | { ok: false; busy?: boolean; error: string }

/** The outcome of a Preview attempt (#475): the live URL, or why not. */
export type PreviewResult =
  | { ok: true; url: string; command: string }
  | { ok: false; error: string }

/** Whether a project's Preview is running, and where (#475). */
export interface PreviewStatus {
  running: boolean
  url?: string
  command?: string
}
