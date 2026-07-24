// Browser-safe entry for the dashboard client (#431). Only pure event projections live
// here — `formatFrameworkEvent` and the run-view derivations — with no Node imports, so
// the client can import these at runtime without dragging the server barrel (relay,
// sandbox, node:fs/http, …) into the browser bundle. Types come from the root entry.
export { AGENTS, AGENT_LABELS, isAgentName, agentForDriver, type AgentName } from './agent-names.js'
export { formatFrameworkEvent } from './terminal.js'
export { formatBytes } from './format-bytes.js'
export { errorMessage } from './error-message.js'
export { pickedIds } from './events.js'
export {
  loopStatus,
  sessionInfo,
  deployPlan,
  runProgress,
  handoffState,
  type LoopStatus,
  type SessionInfo,
  type DeployPlan,
  type RunProgress,
  type HandoffState,
} from './run-view.js'
// The Start-a-run presets (#433): pure prompt builders (no Node imports) the dashboard
// prefills into the textarea, then runs verbatim as a `prompt` kind.
// The prompt-wrapping logic itself (#520), so the dashboard can show the user the
// built-in prompt *before* a run rather than describing it. These are pure string
// work — `loadUserSystemPrompt` is the module's only Node-bound export and stays
// out of here, which is what keeps this importable in a browser.
export {
  systemPromptBlock,
  composeRunSystem,
  renderSystemPrompt,
  SYSTEM_PROMPT_TEMPLATE,
  type SystemPromptOptions,
  type RunSystemOptions,
  type TfContext,
  type EcoOptions,
  type RenderedSystemPrompt,
} from './system-prompt.js'
// What a preset can read beyond its params (#874), so the dashboard can render a preset against
// the session it was launched from. Pure string work, like the renderers below.
export { defaultWhat, DEFAULT_WHAT, type PresetRenderContext } from './preset-prompt.js'
export { presets, LAUNCHER_PRESETS, type PresetKey } from './preset-catalog.js'
// The identity + diff both notifier paths run, and the preference defaults both sides read (#627).
// Pure, so the dashboard shares them rather than keeping copies that drift silently.
export { interventionKey, pickNewInterventions, activityKey, pickNewActivity } from './dashboard/keys.js'
export { PROJECT_PREFERENCE_KEYS, NOTIFICATION_DEFAULTS, MAX_SPEND_OFFSET, notificationEnabled, discordNotificationEnabled, type ProjectPreferences } from './preference-defaults.js'
// The preferences -> run options mapping (#858), shared with the daemon so an unattended run
// starts with the same settings a launcher-started one would. Pure field logic, no Node imports.
export { runOptionsFromPreferences, autopilotEnabled, handoffFromPreferences, preferencesFromFileConfig } from './run-options.js'
// The Discord credential rules (#1095): the same precedence and validation the daemon enforces,
// so the setup dialog rejects a malformed token before the round trip instead of guessing at it.
export {
  credentialEnvVar,
  validateCredential,
  type CredentialSource,
  type DiscordCredentials,
  type DiscordCredentialStatus,
  type DiscordCredentialsPatch,
} from './discord-credentials.js'
