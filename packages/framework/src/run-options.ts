import type { Preferences } from './registry.js'
import type { StartRunOptions } from './dashboard/types.js'

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

/** Autopilot defaults on (the demo default), matching the old localStorage semantics. */
export function autopilotEnabled(preferences: Preferences): boolean {
  return preferences.autopilot ?? true
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
  const model = preferences.model ?? ''
  const agent = preferences.agent ?? 'claude'
  const ecoDrops = {
    ...(preferences.ecoPlanning ? { autoPlanning: true } : {}),
    ...(preferences.ecoResearch ? { autoResearch: true } : {}),
    ...(preferences.ecoMaintenance ? { autoMaintenance: true } : {}),
  }
  return {
    ...(autopilot ? { autopilot: true } : {}),
    ...(technical ? { technical: true } : {}),
    ...(vanilla ? { vanilla: true } : {}),
    ...(transparent ? { transparent: true } : {}),
    ...(eco && !vanilla && !transparent && Object.keys(ecoDrops).length ? { eco: ecoDrops } : {}),
    ...(onBeforeMergeableQuality ? { onBeforeMergeable: true } : {}),
    // Claude-only (#801): another agent's driver takes no MCP servers, so sending it would only earn
    // the CLI's "no effect" notice. Matches the box being disabled off Claude Code.
    ...(browser && agent === 'claude' ? { browser: true } : {}),
    ...(model ? { model } : {}),
    ...(agent !== 'claude' ? { agent } : {}),
    ...(context.length ? { context } : {}),
  }
}
