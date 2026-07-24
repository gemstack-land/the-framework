import type { Preferences } from '@gemstack/the-framework'
import { AGENTS, AGENT_LABELS, autopilotEnabled, handoffFromPreferences, type AgentName } from '@gemstack/the-framework/client'

// The Global options as one table (#314), and the rules between them.
//
// This used to be built inline in the composer, which was fine while the launcher was the only
// place that showed it. The settings page (#958) shows the same options, and a second hand-rolled
// copy would drift: the rules here are not decoration, they decide whether a box means anything
// (Eco under Vanilla trims nothing; Browser on Codex is inert). One table, rendered by both.
//
// It is pure data — no JSX — so the launcher can render it as dropdown items and the settings page
// as page rows, without either one owning the rules.

export type OptionRow = {
  key: keyof Preferences
  label: string
  title: string
  /** A short one-line summary shown under the label (#654). */
  description?: string
  checked: boolean
  /** Disabled beyond the form-wide busy flag (e.g. Eco has nothing to trim under Vanilla). */
  disabled?: boolean
  /** Why it's disabled, shown in the description so a greyed row isn't a mystery (the `title`
   * tooltip is suppressed on disabled dropdown items). Only rendered while {@link disabled}. */
  disabledReason?: string
}

/** The main run options and the Eco sub-drops, with every rule between them already applied. */
export interface RunOptionRows {
  main: OptionRow[]
  eco: OptionRow[]
}

/**
 * The run-option table for a resolved set of preferences.
 *
 * `checked` is the *effective* value, not the stored one: an option overridden by Transparent reads
 * as off, because that is what the run will do. So a surface that renders this can never claim an
 * option is on while the run ignores it.
 */
export function runOptionRows(preferences: Preferences): RunOptionRows {
  const transparent = preferences.transparent ?? false // #625: the master off-switch
  const autopilot = autopilotEnabled(preferences) // default-on lives in autopilotEnabled
  const technical = preferences.technical ?? false
  const vanilla = preferences.vanilla ?? false
  const eco = preferences.eco ?? false
  const ecoPlanning = preferences.ecoPlanning ?? false
  const ecoResearch = preferences.ecoResearch ?? false
  const ecoMaintenance = preferences.ecoMaintenance ?? false
  const onBeforeMergeableQuality = preferences.onBeforeMergeableQuality ?? false
  const browser = preferences.browser ?? false
  // Default-on (#1102), so it reads through `handoffFromPreferences` rather than `?? false` like
  // the rest — and that helper is also what makes PR imply push.
  const handoff = handoffFromPreferences(preferences)
  const agent = preferences.agent ?? 'claude' // #650: which coding agent drives the run
  // The stored agent as a display name; an unknown stored value falls back to Claude Code.
  const agentLabel = AGENT_LABELS[AGENTS.includes(agent as AgentName) ? (agent as AgentName) : 'claude']

  // Vanilla removes the system prompt (nothing left for Eco to trim); Transparent turns off the
  // whole framework, so it overrides the rest too.
  const ecoDisabled = vanilla || transparent
  // The Eco sub-drops trim sections of a prompt Eco itself is what trims, so they are inert unless
  // Eco is actually in force. The launcher hides them instead of greying them (it only renders them
  // while Eco is on), so this only ever bites on a surface that lists them unconditionally.
  const ecoOff = !eco || ecoDisabled

  const main: OptionRow[] = [
    // Named for the agent actually selected (#948): under Codex, "Raw Claude Code" was a lie.
    {
      key: 'transparent',
      label: 'Transparent',
      description: `Raw ${agentLabel} — turns the whole framework off.`,
      title: `Fully transparent (#625): run the agent exactly like plain ${agentLabel}, with no framework system prompt, controls, dashboard, guard, or TODO loop. Overrides the options below.`,
      checked: transparent,
    },
    // Says only what it does (#801): the maintenance stance it used to relax left the system prompt
    // with that section (#556), so the countdown is the whole feature.
    {
      key: 'autopilot',
      label: 'Autopilot',
      description: 'Auto-accepts the recommended choice after a countdown.',
      title: 'Auto-accept the recommended choice after a countdown, instead of waiting for you to pick',
      checked: autopilot && !transparent,
      ...overriddenByTransparent(transparent),
    },
    {
      key: 'technical',
      label: 'Technical control',
      description: 'Surfaces technical detail like tech-stack choices.',
      title: 'Expose technical detail (e.g. tech-stack choices)',
      checked: technical && !transparent,
      ...overriddenByTransparent(transparent),
    },
    {
      key: 'vanilla',
      label: 'Disable system prompt',
      description: 'Drops the added system prompt; keeps the session controls.',
      title:
        "Remove the built-in system prompt but keep the framework's session controls. For a fully raw session, use Transparent. Expand 'Enhanced System Prompt' to read what it removes.",
      checked: vanilla && !transparent,
      ...overriddenByTransparent(transparent),
    },
    {
      key: 'eco',
      label: 'Eco',
      description: 'Trims the system prompt to save tokens.',
      title: 'Trim the built-in system prompt to save tokens',
      checked: eco && !ecoDisabled,
      ...(ecoDisabled ? { disabled: true, disabledReason: 'nothing to trim while the system prompt is off' } : {}),
    },
    {
      key: 'onBeforeMergeableQuality',
      label: 'Post-merge cleanup',
      description: 'Runs quality passes once it is ready to merge.',
      title: "When the session signals it's ready for merge, run maintainability, readability, and security-audit passes",
      checked: onBeforeMergeableQuality && !transparent,
      ...overriddenByTransparent(transparent),
    },
    // Where the two handoff boxes get their default (#1102). A session's own action bar can still
    // untick them for that one run; this is what every new session starts from.
    {
      key: 'autoPushBranch',
      label: 'Push branch',
      description: 'Pushes the session branch to origin when it finishes.',
      title: "Push the session's branch to origin when it finishes, so the work is never left only on this machine",
      checked: handoff.push,
      ...(handoff.pr ? { disabled: true, disabledReason: 'opening a PR already pushes the branch' } : {}),
    },
    {
      key: 'autoOpenPr',
      label: 'Open PR',
      description: 'Opens a draft pull request when it finishes.',
      title: 'Open a draft pull request when the session finishes. Draft, so it does not request review; it still shows on the needs-you queue',
      checked: handoff.pr,
    },
    // Claude-only (#801): the browser is wired through Claude Code's MCP config, so another agent's
    // driver takes no MCP servers and the box would be checkable but inert.
    {
      key: 'browser',
      label: 'Browser',
      description: 'Gives the agent a real browser to inspect pages.',
      title:
        'Give the agent a real browser via chrome-devtools-mcp: navigate pages, read console + network, inspect the DOM, and screenshot',
      checked: browser && !transparent && agent === 'claude',
      ...(transparent || agent !== 'claude'
        ? {
            disabled: true,
            disabledReason: transparent
              ? 'off while Transparent is on'
              : 'only on Claude Code — the browser is wired through its MCP config',
          }
        : {}),
    },
  ]

  const ecoRows: OptionRow[] = [
    {
      key: 'ecoPlanning',
      label: 'Auto planning',
      description: 'Drops the planning section; the agent plans itself.',
      title: 'Drop the planning section, letting the agent plan on its own',
      checked: ecoPlanning && !ecoOff,
      ...(ecoOff ? { disabled: true, disabledReason: 'only applies while Eco is on' } : {}),
    },
    {
      key: 'ecoResearch',
      label: 'Auto research',
      description: 'Drops the alternatives/variability section.',
      title: 'Drop the alternatives/variability section',
      checked: ecoResearch && !ecoOff,
      ...(ecoOff ? { disabled: true, disabledReason: 'only applies while Eco is on' } : {}),
    },
    // Gated on Post-merge cleanup (#801): #556 moved the Maintenance section out of the system
    // prompt and into the on-before-mergeable prompt, so this trims nothing unless that pass runs.
    {
      key: 'ecoMaintenance',
      label: 'Auto maintenance',
      description: 'Drops the maintenance section from the post-merge prompt.',
      title: 'Drop the Maintenance section from the post-merge cleanup prompt',
      checked: ecoMaintenance && onBeforeMergeableQuality && !ecoOff,
      ...(ecoOff || !onBeforeMergeableQuality
        ? {
            disabled: true,
            disabledReason: ecoOff ? 'only applies while Eco is on' : 'only applies while Post-merge cleanup is on',
          }
        : {}),
    },
  ]

  return { main, eco: ecoRows }
}

/** The shared "Transparent overrides it" disable, which most of the main rows carry. */
function overriddenByTransparent(transparent: boolean): Pick<OptionRow, 'disabled' | 'disabledReason'> {
  return transparent ? { disabled: true, disabledReason: 'off while Transparent is on' } : {}
}
