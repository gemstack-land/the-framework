import type { Preferences } from '@gemstack/framework'
import { runOptionsFromPreferences } from '@gemstack/framework/client'

// The Global run options for `sendStart`, derived from the shared preferences (#410) plus the run
// Context set. Shared by the launcher (StartRunForm) and the navbar quick-launch (#723) so a run
// starts the same way from either surface. Mirrors the toggles the OptionsMenu + AgentModelMenu
// write.
//
// The mapping itself moved into @gemstack/framework (#858) so the daemon can use it too: auto PM
// starts runs with nobody watching and passed no options at all, which silently ignored the
// project's agent and model. This stays as the client's name for it.
export function collectRunOptions(preferences: Preferences, context: string[] = []) {
  return runOptionsFromPreferences(preferences, context)
}
