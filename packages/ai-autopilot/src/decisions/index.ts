/**
 * Decisions — the durable memory layer of `@gemstack/ai-autopilot`.
 *
 * A {@link DecisionLedger} records the choices and rejected ideas of a project
 * so a run stops re-pitching what was already turned down. Record with
 * {@link DecisionLedger.record}, check before proposing with
 * {@link DecisionLedger.consult}, and round-trip a human-editable `DECISIONS.md`
 * with {@link loadLedger} / {@link saveLedger}. Expose it to an agent with
 * {@link decisionTools} and {@link decisionBriefing}.
 */
export { defineDecision, DecisionError, slugify } from './define.js'
export { DecisionLedger, createLedger, type ConsultOptions } from './ledger.js'
export { parseDecisions, serializeDecisions } from './markdown.js'
export {
  loadLedger,
  saveLedger,
  nodeLedgerFs,
  DECISIONS_FILE,
  type LedgerFs,
} from './store.js'
export {
  decisionTools,
  decisionBriefing,
  type DecisionToolsOptions,
} from './tools.js'
export type { Decision, DecisionSpec, DecisionStatus, DecisionMatch } from './types.js'
