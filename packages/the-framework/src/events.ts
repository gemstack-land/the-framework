import type { BootstrapEvent } from '@gemstack/ai-autopilot'
import type { DriverEvent } from './driver/index.js'

/** One selectable option in an interactive {@link ChoiceRequest} (#304). */
export interface ChoiceOption {
  /** Stable id posted back when this option is picked. */
  id: string
  /** The option shown to the user. */
  label: string
  /** Optional one-line detail under the label (e.g. why an alternative lost). */
  detail?: string
  /** In a multi-select ({@link ChoiceRequest.multi}), whether this option starts checked. Ignored for single-select. */
  default?: boolean
}

/**
 * An interactive choice the run pauses on until a pick arrives (#304). Emitted as
 * a `choice` {@link FrameworkEvent}; the dashboard renders it in a panel and posts
 * the pick back. The recommended option is the default the autopilot auto-accepts.
 */
export interface ChoiceRequest {
  /** Unique id for this pending choice; the pick is posted back against it. */
  id: string
  /** The question shown above the options (e.g. "Approve this plan?"). */
  title: string
  /** The options to choose between (at least one). */
  options: readonly ChoiceOption[]
  /**
   * The option id pre-selected as the default (autopilot auto-accepts it). Required
   * for a single-select; omitted for a {@link multi} select, where each option's own
   * {@link ChoiceOption.default} drives the pre-checked set instead.
   */
  recommended?: string
  /**
   * Render as a multi-select checklist (#332): each option is a checkbox pre-checked
   * per its {@link ChoiceOption.default}, and the pick resolves to the selected
   * *subset* of ids rather than one. Absent = the single-select gate (#304).
   */
  multi?: boolean
  /** Auto-accept the recommended option after this many ms when autopilot is on. Default 10000. */
  autoAcceptMs?: number
  /**
   * Render as an Approve/Decline confirmation (#358): the dashboard shows a green
   * Approve and a red Decline button instead of the option list. The options still
   * carry the two ids, so the pick machinery is unchanged.
   */
  confirm?: boolean
  /** The markdown file under approval (e.g. `PLAN_<slug>.agent.md`); the doc sidebar renders it. */
  file?: string
}

/**
 * Why the #326 post-merge cleanup step declined to run (#835). Every decline carries one,
 * so "I turned it on and nothing happened" has an answer in the log.
 */
export type OnBeforeMergeableSkip =
  /** The agent never signalled `setReadyForMerge()`, so there is nothing to clean up after. */
  | 'not-ready-for-merge'
  /** The run was stopped (Stop button, Ctrl+C, budget cap) rather than finished. */
  | 'run-stopped'
  /** A fake/offline run: no agent to hand the follow-up prompt to. */
  | 'fake-run'
  /** The agent never called `setSessionName()`, which every line of the prompt names. */
  | 'no-session-name'
  /** `process.argv[1]` was empty, so there is no binary to spawn the follow-up with. */
  | 'no-bin-path'

/**
 * Why the end-of-session handoff (#1102) did nothing. Every one of these is a normal end rather
 * than a fault, and each is reported so that "it was ticked and nothing happened" has an answer.
 *
 * Lives here beside {@link OnBeforeMergeableSkip} rather than with the handoff logic, because the
 * event union is a leaf: the module that decides these imports the type, not the other way round.
 */
export type AutoHandoffSkip =
  /** Neither box was ticked, so there was nothing to do. */
  | 'not-armed'
  /** The branch no longer exists (deleted, or never created). */
  | 'branch-gone'
  /** The session committed nothing the base branch does not already have. */
  | 'no-commits'
  /**
   * The session's pending work could not be committed (#1376), so publishing would hand off a
   * branch missing its last edits. The work stays in the checkout; teardown retries the commit.
   */
  | 'commit-failed'
  /** The repo has no remote to push to. */
  | 'no-remote'
  /** The branch already has a PR: opening a second one is the one mistake this must not make. */
  | 'already-open'
  /** The branch is already on the remote at this commit, and only the push was asked for. */
  | 'already-pushed'
  /** The run was stopped (Stop button, Ctrl+C, budget cap) rather than finished. */
  | 'run-stopped'
  /** A fake/offline run: nothing real to publish. */
  | 'fake-run'

/**
 * Why an armed merge did not run (#1363). The run's config arms the merge; the authorization is
 * the agent's, not the config's (rule settled on #1390): the agent must have declared the work
 * done, and the framework must not already know of work pending in this session. The global
 * `TODO_AGENTS.md` queue never withholds a merge — it is decoupled from sessions.
 */
export type MergeWithheldReason =
  /** The agent never called setReadyForMerge(): the work was never declared done. */
  | 'not-ready-for-merge'
  /** The session's own `TODO_<SESSION_NAME>.agent.md` still has open entries. */
  | 'session-todo-open'

/**
 * How the merge half of a handoff went (#1216), when the run was armed for it. Lives here beside
 * {@link AutoHandoffSkip} for the same leaf-module reason.
 *
 * `auto-armed` is the preferred outcome: GitHub's own auto-merge takes the PR, so it lands when
 * its checks pass rather than before them. `merged` is the fallback where the repo does not allow
 * auto-merge and the PR was merged directly. `failed` never fails the handoff — the PR exists
 * either way, a human can still merge it by hand. `withheld` means the merge never ran at all
 * (#1363): it was armed but not authorized, and the PR opened as a draft for a human instead.
 */
export type AutoMergeOutcome =
  | { outcome: 'auto-armed' | 'merged' }
  | { outcome: 'withheld'; reason: MergeWithheldReason }
  | { outcome: 'failed'; error: string }

/** Who resolved a {@link ChoiceRequest}: a human, the autopilot countdown, or a headless auto-accept. */
export type ChoiceBy = 'user' | 'autopilot' | 'auto'

/** What a {@link import('./run.js').RunFrameworkOptions.requestChoice} handler resolves with. */
export interface ChoicePick {
  /** The picked option id, or (for a {@link ChoiceRequest.multi} select) the selected subset of ids. */
  picked: string | readonly string[]
  /** Who picked it. Default `'user'`. */
  by?: ChoiceBy
}

/** Normalize a {@link ChoicePick} (single id or subset) to a list of picked ids. */
export function pickedIds(picked: string | readonly string[]): string[] {
  return Array.isArray(picked) ? [...picked] : picked ? [picked as string] : []
}

/**
 * The single event type the whole run streams over. It unifies three sources so
 * the dashboard (and terminal) render one timeline: bootstrap-phase narration
 * (the moat: checklist verdicts, deploy), the wrapped
 * agent's own black-box progress, and framework-level status. We own this stream
 * (guardrail #2, #165) rather than surfacing the agent's transport directly.
 */
export type FrameworkEvent =
  /** Emitted once at start: which agent is wrapped, the workspace, and a link. */
  | { kind: 'session'; driver: string; workspace: string; fake: boolean; sessionLink?: string }
  /**
   * Emitted once the wrapped agent reports its real session id (not known at
   * start). Carries the live id and, when a link template was supplied, the
   * resolved URL to jump into that session (#165). Re-emitted if the id changes
   * (each Claude Code prompt is a fresh session), keeping the link current.
   */
  | { kind: 'session-update'; sessionId: string; sessionLink?: string }
  /**
   * The full system prompt sent to the wrapped agent for this run (#343): the
   * #326 block plus any personas / skills / memory framing, exactly as passed to
   * the driver's system channel. Emitted once at session start so the dashboard
   * can show the normally-hidden prompt (the per-turn user prompts arrive as
   * `driver` `start` events, which already carry their text). Transparency, never
   * gated on.
   */
  | { kind: 'system-prompt'; text: string }
  /** A bootstrap-phase narration event (scope / checklist / deploy / ...). */
  | { kind: 'bootstrap'; event: BootstrapEvent }
  /** The wrapped agent's own progress, forwarded verbatim (never gated on). */
  | { kind: 'driver'; event: DriverEvent }
  /**
   * The generated app is booted and serving. Emitted after a successful run when
   * a serve config is set: the app is kept running so the user can open it, and
   * the dashboard shows a live preview link (torn down on Ctrl+C).
   */
  | { kind: 'preview'; url: string; command: string }
  /**
   * The run's browser preview is up and listening on this loopback port (#813).
   *
   * Only the port travels. The dashboard reaches the stream through the daemon, which proxies
   * to this port, so the run's bridge stays same-origin-invisible and unreachable from the web.
   * Frames themselves never enter the log: someone will type a password into that pane.
   */
  | { kind: 'browser-stream'; port: number }
  /** A framework-level log line. */
  | { kind: 'log'; message: string }
  /**
   * An ad-hoc markdown view the agent pushed to show the user (#441), e.g. a plan,
   * a summary, or a diff writeup. Non-blocking (unlike a `choice`): the dashboard
   * renders it as a view in the right rail. `id` is stable per title, so re-showing
   * the same view updates it in place rather than stacking a duplicate.
   */
  | { kind: 'view'; id: string; title: string; markdown: string }
  /**
   * The agent named the session (#326): the `[a-z0-9-]` slug it chose (also its
   * `the-framework/<name>` branch), from a `setSessionName()` signal. Non-blocking;
   * the dashboard shows it as the run's label. Re-emitted on a rename.
   */
  | { kind: 'session-name'; name: string }
  /**
   * The agent signalled `setReadyForMerge()` (#326): it believes the work is complete
   * and ready for human review. Non-blocking — it flips the run's dashboard status from
   * building (orange) to ready (green); the on-before-mergeable quality prompts hang off it.
   */
  | { kind: 'ready-for-merge' }
  /**
   * The #326 post-merge cleanup step settled (#835): it queued the quality follow-ups,
   * queued them but did not finish cleanly, or declined with a {@link OnBeforeMergeableSkip}.
   *
   * An event rather than stdout because the surfaces that need it cannot read stdout: a
   * dashboard-started run is spawned with `stdio: 'ignore'`. Emitted only when the option
   * was on, so a run that never asked for the step stays quiet.
   */
  | { kind: 'on-before-mergeable'; outcome: 'queued' | 'incomplete' }
  | { kind: 'on-before-mergeable'; outcome: 'skipped'; reason: OnBeforeMergeableSkip }
  /**
   * What the end-of-session handoff is armed to do (#1102), emitted at the start and again
   * whenever the dashboard's checkboxes change it.
   *
   * This is what makes the boxes survive a reload: the control channel carries the instruction,
   * but only an event reaches the run's meta, which is the one thing a tab opened later can read.
   *
   * `merge` carries the auto-merge arming (#1216) so the armed line can say the most consequential
   * half of the plan (#1382): without it a merge-armed run advertised "open a draft PR" and then
   * merged to main. Optional because journals written before #1382 lack it; absent reads as off,
   * the conservative display. It has no checkbox and never changes mid-run, so re-emits repeat it.
   */
  | { kind: 'handoff-armed'; push: boolean; pr: boolean; merge?: boolean }
  /**
   * The ticket this run was started to implement (#1117), as a repo-relative `tickets/<file>.md`.
   *
   * Emitted once at start, and only when the framework itself chose the ticket — today that is the
   * [Drain queue] run, whose queue entry links back to the ticket it was queued from (#1164). An
   * event rather than a start argument for the usual reason: only an event reaches the run's meta,
   * and the meta is what a dashboard tab opened mid-run reads. Absent means nobody knows what this
   * run is implementing, which is every hand-written prompt.
   */
  | { kind: 'ticket'; path: string }
  /**
   * The one queue entry this run was pinned to by the routine's drain (#1253). An event for the
   * same reason `ticket` is: only an event reaches the run's meta, and the meta is what outlives
   * the sweep's memory — the claim must survive a daemon restart, and a hands-off run whose local
   * process ends at the hand-off while the cloud session still works the entry.
   */
  | { kind: 'queue-entry'; entry: string }
  /**
   * The branch the run's work is on (#1277), observed off the checkout rather than guessed:
   * emitted at start with the branch the run actually begins on, and again when the framework
   * renames the run-id branch after the agent names the session. Folded to `RunMeta.branch`,
   * which every surface resolves first — before this event the branch was stamped only at
   * teardown (#799), so any read before that guessed between three naming schemes.
   */
  | { kind: 'branch'; branch: string }
  /**
   * What the end-of-session handoff actually did (#1102): pushed and/or opened a draft PR,
   * declined for a reason that is not a fault, or failed at one of the two steps.
   *
   * Same reason as on-before-mergeable above: a dashboard-started run has no stdout anyone reads,
   * so an outcome that is not an event is an outcome nobody learns.
   */
  | { kind: 'handoff'; outcome: 'skipped'; reason: AutoHandoffSkip; merge?: AutoMergeOutcome }
  | { kind: 'handoff'; outcome: 'done'; pushed: boolean; url?: string; merge?: AutoMergeOutcome }
  | { kind: 'handoff'; outcome: 'failed'; step: 'push' | 'pr'; error: string }
  /**
   * The work has settled and the run is parked on the user (#785): it stays open as a
   * conversation (#714), so its process is still alive and it still takes messages, but
   * the agent is not doing anything until you say something.
   *
   * Emitted each time the run parks, and undone by the next `driver` `start` — so "is it
   * working or waiting for me" is answerable from the event log rather than inferred from
   * a status that only changes when the run ends.
   */
  | { kind: 'settled' }
  /**
   * A project-less topic run (#1120) bound itself to a project (#1121): the agent ended a turn on
   * an `await-bind-project` / `await-create-project` gate, which the framework resolved by
   * registering + binding the project. Recorded so the run's meta names the project it re-homes
   * into (#1122).
   */
  | { kind: 'bind'; projectId: string }
  /**
   * Cumulative token + cost usage for the run so far (#322). Emitted after each
   * agent turn that reports usage; the dashboard renders a live spend readout and
   * the run stops itself once `costUsd` reaches the budget cap, if one is set.
   *
   * `costUsd` is absent when the agent reports tokens but no price (#540), which
   * is also when no budget cap can fire.
   */
  | {
      kind: 'usage'
      costUsd?: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      turns: number
      /** The budget cap in USD this run is gated on, when one was set. */
      budgetUsd?: number
    }
  /**
   * The run's active Open Loop modes (#272), emitted once when a domain preset is
   * in effect. `all` is every mode the run knows about (stable order); `active` is
   * the subset switched on for this run. The dashboard renders them as read-only
   * checkboxes so the policy driving the build is visible.
   */
  | { kind: 'modes'; all: readonly string[]; active: readonly string[] }
  /**
   * The run paused on an interactive choice (#304) and is awaiting a pick. The
   * dashboard renders the options with the recommended default pre-selected and
   * posts the pick back; a headless run auto-accepts the recommended option.
   */
  | ({ kind: 'choice' } & ChoiceRequest)
  /** A pending {@link ChoiceRequest} was resolved — the run continues on `picked` (one id, or the selected subset). */
  | { kind: 'choice-resolved'; id: string; picked: string | readonly string[]; by: ChoiceBy }
  /**
   * The run finished. `ok` is false when it threw. `stopped` marks the common,
   * non-error case where the user interrupted it (the dashboard Stop button /
   * Ctrl+C), so a surface can show "stopped" rather than "failed".
   */
  | { kind: 'end'; ok: boolean; stopped?: boolean; detail?: string }

/**
 * The Open Loop modes a run can activate, in the order the dashboard shows them.
 * The single source of truth for the mode checkboxes (#272).
 */
export const OPEN_LOOP_MODES = ['autopilot', 'technical'] as const
