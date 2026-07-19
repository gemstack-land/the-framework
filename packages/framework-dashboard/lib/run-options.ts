import type { Preferences } from '@gemstack/framework'
import { autopilotEnabled } from './preferences.js'

// The Global run options for `sendStart`, derived from the shared preferences (#410) plus the run
// Context set. Shared by the launcher (StartRunForm) and the navbar quick-launch (#723) so a run
// starts the same way from either surface. Mirrors the toggles the OptionsMenu + AgentModelMenu
// write. Returned as an inferred literal, not annotated: `StartRunOptions` isn't re-exported to the
// client bundle, and `sendStart` type-checks the shape at the call site (as the inline version did).
export function collectRunOptions(preferences: Preferences, context: string[] = []) {
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
    ...(browser ? { browser: true } : {}),
    ...(model ? { model } : {}),
    ...(agent && agent !== 'claude' ? { agent } : {}),
    ...(context.length ? { context } : {}),
  }
}
