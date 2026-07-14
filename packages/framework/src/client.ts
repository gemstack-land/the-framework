// Browser-safe entry for the dashboard client (#431). Only pure event projections live
// here — `formatFrameworkEvent` and the run-view derivations — with no Node imports, so
// the client can import these at runtime without dragging the server barrel (relay,
// sandbox, node:fs/http, …) into the browser bundle. Types come from the root entry.
export { formatFrameworkEvent, pickedIds } from './events.js'
export {
  architectPlan,
  decisionLedger,
  loopStatus,
  sessionInfo,
  deployPlan,
  runProgress,
  type ArchitectPlan,
  type Decision,
  type LoopStatus,
  type SessionInfo,
  type DeployPlan,
  type RunProgress,
} from './run-view.js'
// The Start-a-run presets (#433): pure prompt builders (no Node imports) the dashboard
// prefills into the textarea, then runs verbatim as a `prompt` kind.
export { renderResearchPrompt } from './research-preset.js'
export { renderReadabilityPrompt } from './readability-preset.js'
export { renderMaintainabilityPrompt } from './maintainability-preset.js'
export { renderSecurityAuditPrompt } from './security-audit-preset.js'
export { renderUxPrompt } from './ux-preset.js'
