import type { Preferences } from './registry.js'
import type { StartRunOptions } from './dashboard/types.js'
import type { FrameworkFileConfig } from './config.js'

/**
 * Turning the user's preferences into the options a run starts with (#858).
 *
 * This lived in the dashboard client, which was fine while the browser was the only thing that
 * started runs. Auto PM (#685) starts them too, and passed nothing at all — so an unattended run
 * ignored the agent, the model and every other per-project setting (#840) that a run started from
 * the launcher would have honoured.
 *
 * It lives here, in pure code with no Node imports, so both callers share one mapping rather than
 * keeping two copies of rules that are not a plain field copy: autopilot defaults on, browser is
 * Claude-only, the eco drops are suppressed under vanilla/transparent, and the four eco
 * preferences collapse into one object. Re-exported from the browser-safe `./client` entry (#431)
 * so the dashboard can go on importing it at runtime.
 */

/**
 * A repo's committed `the-framework.yml` as the preference keys it speaks for (#842), so the
 * launcher and the daemon can layer it under the user's own options the same way. Only the keys
 * the file set come back, since an unset key must leave the tier below it alone.
 *
 * `antiLazyPill` is the file's name for the inverse of Vanilla: removing the built-in prompt.
 * `preset` and `event` have no preference counterpart (there is no preset picker) and stay on the
 * raw file config for display.
 */
export function preferencesFromFileConfig(file: FrameworkFileConfig): Preferences {
  return {
    ...(file.autopilot !== undefined ? { autopilot: file.autopilot } : {}),
    ...(file.technical !== undefined ? { technical: file.technical } : {}),
    ...(file.transparent !== undefined ? { transparent: file.transparent } : {}),
    ...(file.antiLazyPill !== undefined ? { vanilla: !file.antiLazyPill } : {}),
  }
}

/** Autopilot defaults on (the demo default), matching the old localStorage semantics. */
export function autopilotEnabled(preferences: Preferences): boolean {
  return preferences.autopilot ?? true
}

/**
 * The end-of-session handoff a set of preferences arms (#1102). Both halves default on, which is
 * what makes it zero-config: a session left alone pushes its branch and opens a draft PR.
 *
 * Opening a PR implies pushing — `gh` will not open one for a branch the remote has never seen —
 * so the pair is normalised here rather than in the three places that read it.
 */
export function handoffFromPreferences(preferences: Preferences): { push: boolean; pr: boolean } {
  const pr = preferences.autoOpenPr ?? true
  return { push: pr || (preferences.autoPushBranch ?? true), pr }
}

/**
 * The run options a set of already-resolved preferences implies.
 *
 * Takes the merged view, not the two tiers: who wins between the global and the project setting is
 * `resolvePreferences`' job, and this stays a pure mapping of one settled answer.
 */
export function runOptionsFromPreferences(preferences: Preferences, context: string[] = []): StartRunOptions {
  const autopilot = autopilotEnabled(preferences)
  const vanilla = preferences.vanilla ?? false
  const transparent = preferences.transparent ?? false
  const eco = preferences.eco ?? false
  const technical = preferences.technical ?? false
  const onBeforeMergeableQuality = preferences.onBeforeMergeableQuality ?? false
  const browser = preferences.browser ?? false
  const handoff = handoffFromPreferences(preferences)
  const model = preferences.model ?? ''
  const agent = preferences.agent ?? 'claude'
  const target = preferences.target ?? 'local'
  const ecoDrops = {
    ...(preferences.ecoPlanning ? { autoPlanning: true } : {}),
    ...(preferences.ecoResearch ? { autoResearch: true } : {}),
    ...(preferences.ecoMaintenance ? { autoMaintenance: true } : {}),
  }
  return {
    // The four toggles `the-framework.yml` also owns go out explicitly, `false` included (#842):
    // the caller has already resolved every layer it can see, so the run states the settled answer
    // and the CLI's own resolve (#841) takes it as the nearest layer. Sending nothing would let the
    // repo file turn back on what the launcher just showed as off.
    autopilot,
    technical,
    vanilla,
    transparent,
    ...(eco && !vanilla && !transparent && Object.keys(ecoDrops).length ? { eco: ecoDrops } : {}),
    ...(onBeforeMergeableQuality ? { onBeforeMergeable: true } : {}),
    // Stated explicitly, `false` included: these default ON (#1102), so sending nothing would let
    // the run's own default turn back on what the launcher just showed as off.
    autoPushBranch: handoff.push,
    autoOpenPr: handoff.pr,
    // Claude-only (#801): another agent's driver takes no MCP servers, so sending it would only earn
    // the CLI's "no effect" notice. Matches the box being disabled off Claude Code.
    ...(browser && agent === 'claude' ? { browser: true } : {}),
    ...(model ? { model } : {}),
    ...(agent !== 'claude' ? { agent } : {}),
    // Run target (#1050): only `actions` travels; `local` is the default the CLI already assumes.
    ...(target === 'actions' ? { target } : {}),
    ...(context.length ? { context } : {}),
  }
}
