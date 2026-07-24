import type { LinkedPr } from './gh.js'
import type { EcoOptions } from '../system-prompt.js'

// The dashboard's request/result vocabulary (#345/#396/#475): the shapes the Start / Add /
// Preview RPCs speak. They live here, on neither the HTTP server nor the Telefunc mount, so
// both — plus the telefunctions themselves — depend on this leaf rather than on each other.

/** The outcome of removing a retained worktree (#737). */
export type RemoveWorktreeResult = { ok: true } | { ok: false; error: string }

/** The outcome of deleting a session — its records and worktree (#1032). */
export type DeleteSessionResult = { ok: true } | { ok: false; error: string }

/** The outcome of an add-project attempt (#396). */
export type AddProjectResult =
  | { ok: true; added: number; alreadyActivated: number }
  | { ok: false; error: string }

/**
 * What the Onboarding checklist (#958) needs and no other read carries: the server's own
 * working directory, offered as the one-click first project.
 *
 * Both fields are null where adding projects is not wired (the relay), so a public host
 * never discloses its filesystem layout.
 */
export interface OnboardingSuggestion {
  /** The server's working directory, or null when it cannot be offered. */
  cwd: string | null
  /** The project id for {@link cwd} when it is already registered, else null. */
  cwdProjectId: string | null
}

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
  /** Remove the built-in #326 system prompt entirely (keeps the emit contract so the dashboard still drives it). */
  vanilla?: boolean
  /** Transparent mode (#625): run the wrapped agent fully raw (no framework system prompt, guard, dashboard, or TODO loop); maps to `--transparent`. */
  transparent?: boolean
  /** Fine-grained #326 section drops to save tokens. */
  eco?: EcoOptions
  /** In-context directories (#439): each becomes a `--context <dir>` flag on the spawned run. */
  context?: string[]
  /** On-before-mergeable prompt (#326): on setReadyForMerge(), queue the quality follow-ups as TODO entries; maps to `--on-before-mergeable`. */
  onBeforeMergeable?: boolean
  /** Give the agent a real browser via chrome-devtools-mcp during the run (#452); maps to `--browser`. */
  browser?: boolean
  /**
   * Push the session's branch to `origin` when it finishes (#1102); maps to `--auto-push-branch`.
   *
   * Tri-state like the four `the-framework.yml` toggles, and for the same reason: it defaults ON,
   * so an explicit `false` has to travel as `--no-auto-push-branch` or the run's own default would
   * turn back on what the launcher showed as off.
   */
  autoPushBranch?: boolean
  /** Open a draft PR for the session's branch when it finishes (#1102); maps to `--auto-open-pr`. Implies {@link autoPushBranch}. */
  autoOpenPr?: boolean
  /** The model to run the wrapped agent on (#628); maps to `--model`. Absent = the driver's own default. */
  model?: string
  /** Which coding agent drives the run (#650): `claude` or `codex`; maps to `--agent`. Absent = the default (`claude`). */
  agent?: string
  /** Where this run executes (#1050): `local` (this device, the default) or `actions` (a fresh GitHub Actions runner via ActionsDriver); maps to `--run-on`. Absent = local, i.e. today's behavior. */
  target?: 'local' | 'actions'
  /**
   * Nobody is watching this run (#846): its choice gates take the recommended option instead of
   * parking for an answer, which is the fallback a fully headless run already uses and the one
   * autopilot would have clicked. Set by the work the daemon starts on its own (auto PM, #685).
   * Stop still works — that aborts the run controller, not a gate.
   */
  unattended?: boolean
  /**
   * The surface this run was asked for from (#917), e.g. `discord`; maps to `--via`. Recorded on
   * the session's conversation turns so a run started from a chat surface is not filed under the
   * dashboard. Absent = the local surface, exactly as before.
   */
  via?: string
  /** Resume a finished run's conversation (#720): its captured agent session id; maps to `--resume-session`. The run's prompt continues that session (full prior context) instead of starting fresh. Sent with `kind: 'prompt'` when you message a run that has ended. */
  resumeSession?: string
  /**
   * Continue this run rather than starting a new one (#762): the follow-up writes into that run's
   * own log, on its own branch, so a stopped run you message again stays one row in the history
   * instead of spawning an unrelated-looking second one.
   */
  continueRunId?: string
  /**
   * Run this session on a connected device (#1067): the local daemon relays the run to the remote
   * daemon at `url` (authenticating with `token` as the `fw_daemon` cookie) and streams its events
   * back into the local run view. The device `label` rides along (memory-only, like `url`/`token`) so
   * the local session list + notice can show which device the run is on after a reload (#1077).
   * Memory-only relay config the dashboard sets at submit time from a saved device. NEVER persisted to
   * Preferences or the registry, and never a CLI flag: a device token is a per-browser secret. Absent =
   * run locally, exactly as today. Stripped before the run is forwarded, so the remote starts an
   * ordinary local run and does not relay onward.
   */
  remote?: { url: string; token: string; label?: string }
  /**
   * Start this run project-less (#1120): it spawns in a neutral scratch dir with no repo or worktree,
   * so the agent has no code to touch — the "ask a question / plan / draft a ticket without a repo"
   * path. Set only by {@link sendStartTopic}; a project run leaves it absent. No `projectId` travels
   * with it, and it allocates no worktree.
   */
  topic?: true
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
  /**
   * `runId` is the id the daemon allocated for the run (#761), present whenever it got its own
   * worktree. The dashboard needs it to select the run it just started: with concurrent runs
   * (#736) it can no longer find that run by looking for "the running one", because the previous
   * run is still running and the new one has not written its `run.json` yet.
   */
  | { ok: true; runId?: string }
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

/**
 * Where a session is working (#798): the checkout, its branch, and what it is holding. Read by
 * the dashboard so a session's action bar can say which worktree it has, rather than leaving the
 * user to infer it from a run id.
 */
export interface RunWorktree {
  /** Absolute path of the checkout this run works in. */
  path: string
  /** True when it is the run's own worktree; false when it fell back to the project's checkout. */
  own: boolean
  /** Uncommitted changes present in that checkout. */
  dirty: boolean
  /** The branch it is on, absent when the path is not a git repo. */
  branch?: string
  /** Size on disk, bytes. Only read once nothing is writing to it, and best-effort even then. */
  sizeBytes?: number
  /** The PR opened for this checkout's branch (#809), when there is one. */
  pr?: LinkedPr
  /** The PR is not known yet, rather than absent (#1028): the lookup is still running. */
  prPending?: boolean
}
