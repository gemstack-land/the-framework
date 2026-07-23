import { createDriver, type CreateDriverOptions } from './agent.js'
import { ActionsDriver, type ActionsDriverOptions, type Driver } from './driver/index.js'

/**
 * Build the {@link Driver} for a run's *target* (#1050): where the turn runs, on top of the agent
 * axis {@link createDriver} owns. `actions` returns an {@link ActionsDriver} (#934) built from the
 * resolved owner/repo/token; anything else falls through to the local agent driver — byte-identical
 * to today.
 *
 * Kept off {@link createDriver} on purpose: ActionsDriver's owner/repo/token do not fit
 * {@link CreateDriverOptions}, and folding them in would push GitHub config onto every local run.
 */
export interface CreateRunDriverOptions extends CreateDriverOptions {
  /** Where the run executes (#1050): `local` (this device, the default) or `actions` (a GitHub Actions runner). */
  target?: 'local' | 'actions'
  /** The Actions runner config, required when {@link target} is `actions`. */
  actionsConfig?: ActionsDriverOptions
}

/** The one place a run path turns `--run-on` into a real driver. */
export function createRunDriver(opts: CreateRunDriverOptions): Driver {
  if (opts.target === 'actions') {
    if (!opts.actionsConfig) {
      throw new Error('run target "actions" needs the repo owner/repo and a GitHub token; set a GitHub origin remote and GH_TOKEN')
    }
    return new ActionsDriver(opts.actionsConfig)
  }
  return createDriver(opts)
}
