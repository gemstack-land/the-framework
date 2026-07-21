import type { Preferences } from './registry.js'

/**
 * Which preference keys a project may override, and what an unset notification preference means.
 *
 * A leaf module (no `node:*`) so `client.ts` can export it and the dashboard reads the same values
 * the daemon acts on. Both were previously written on both sides of the package boundary with
 * nothing tying them together:
 *
 * - the key list was a second `Set<string>` in the dashboard, which erased the type link — adding a
 *   key here type-checked clean while the dashboard silently routed it to the global tier;
 * - the notification defaults were named predicates in the dashboard and open-coded at each daemon
 *   call site, in three different spellings, with a comment warning the reader not to copy the
 *   sibling's polarity. That warning is what a default with one home does not need.
 *
 * No cycle: `registry.ts` re-exports the key list from here, and the `Preferences` import going the
 * other way is type-only, so it erases.
 */

/**
 * The preference keys a project may override (#840).
 *
 * These are the *user's* per-project choices, not the repo's: they live in the user's home file
 * rather than the committed `the-framework.yml` because `model` and `agent` name what this machine
 * runs, which is not something to impose on everyone who clones the repo.
 */
export const PROJECT_PREFERENCE_KEYS = [
  'autopilot',
  'technical',
  'vanilla',
  'eco',
  'ecoPlanning',
  'ecoResearch',
  'ecoMaintenance',
  'onBeforeMergeableQuality',
  'browser',
  'transparent',
  'model',
  'agent',
] as const

/** What one project overrides: a subset of {@link Preferences}, storing only the keys it sets. */
export type ProjectPreferences = Pick<Preferences, (typeof PROJECT_PREFERENCE_KEYS)[number]>

/**
 * What an unset notification preference means.
 *
 * The polarities are not uniform, and that is the point of writing them down once: the "needs you"
 * baseline fires unless you turn it off, while everything that reaches outward (Discord) or acts on
 * what it reads (the bot) is opt-in.
 */
export const NOTIFICATION_DEFAULTS = {
  /** The browser bell for the "needs you" queue (#627). */
  notifyBrowser: true,
  /** The "needs you" category (#627): the baseline The Framework leans on, so unset keeps it firing. */
  notifyHumanIntervention: true,
  /** Plain run activity — started/finished (#627). Loosely informative, so opt-in. */
  notifyNewActivity: false,
  /** Discord delivery (#627): reaches you with no dashboard open, so opt-in. */
  notifyDiscord: false,
  /** The Discord chatbot (#680): it *acts* on what it reads, so opt-in for a stronger reason. */
  discordBot: false,
} as const satisfies Partial<Record<keyof Preferences, boolean>>

/** A notification preference, with its default applied. */
export function notificationEnabled(
  preferences: Preferences,
  key: keyof typeof NOTIFICATION_DEFAULTS,
): boolean {
  return preferences[key] ?? NOTIFICATION_DEFAULTS[key]
}

/**
 * Whether a category should be delivered over Discord: the method (`notifyDiscord`) AND the
 * category must both be on.
 *
 * Both halves in one place, because the composition is the part that was open-coded per call site
 * and got the category's polarity wrong by copying its sibling.
 */
export function discordNotificationEnabled(
  preferences: Preferences,
  category: 'notifyHumanIntervention' | 'notifyNewActivity',
): boolean {
  return notificationEnabled(preferences, 'notifyDiscord') && notificationEnabled(preferences, category)
}
