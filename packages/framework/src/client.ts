// Browser-safe entry for the dashboard client (#431). Only pure event projections live
// here — `formatFrameworkEvent` and the run-view derivations — with no Node imports, so
// the client can import these at runtime without dragging the server barrel (relay,
// sandbox, node:fs/http, …) into the browser bundle. Types come from the root entry.
export { formatFrameworkEvent } from './terminal.js'
export { pickedIds } from './events.js'
export {
  loopStatus,
  sessionInfo,
  deployPlan,
  runProgress,
  type LoopStatus,
  type SessionInfo,
  type DeployPlan,
  type RunProgress,
} from './run-view.js'
// The Start-a-run presets (#433): pure prompt builders (no Node imports) the dashboard
// prefills into the textarea, then runs verbatim as a `prompt` kind.
export { DEFAULT_CONSUMPTION_LIMITS } from './consumption.js'
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
export { renderResearchPrompt } from './research-preset.js'
export { renderReadabilityPrompt } from './readability-preset.js'
export { renderMaintainabilityPrompt } from './maintainability-preset.js'
export { renderSecurityAuditPrompt } from './security-audit-preset.js'
export { renderUxPrompt } from './ux-preset.js'
export { renderSuggestNewTicketsPrompt } from './suggest-new-tickets-preset.js'
