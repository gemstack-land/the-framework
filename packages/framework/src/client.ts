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
  type ArchitectPlan,
  type Decision,
  type LoopStatus,
  type SessionInfo,
} from './run-view.js'
