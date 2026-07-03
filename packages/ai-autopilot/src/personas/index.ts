/**
 * Personas — the stack-aware knowledge layer of `@gemstack/ai-autopilot`.
 *
 * A {@link Persona} is a reusable role (identity + skills + tools) that knows
 * the GemStack stack. Define one with {@link definePersona}, materialize it into
 * an agent with {@link personaAgent}, wire a set as Supervisor workers with
 * {@link personaWorkers}, and describe them to a planner with
 * {@link personaRoster}.
 */
export { definePersona, PersonaError } from './define.js'
export {
  personaInstructions,
  personaTools,
  personaAgent,
  personaWorkers,
  personaRoster,
  type PersonaAgentOptions,
} from './compose.js'
export {
  vikePageBuilder,
  nextPageBuilder,
  dataModeler,
  uiIntentDesigner,
  vikeAuthComposer,
  vikeDataModeler,
  sharedPersonas,
  vikeExtensionPersonas,
  stackPersonas,
} from './library.js'
export type { Persona, PersonaSpec } from './types.js'
