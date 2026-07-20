import type { FrameworkFileConfig, Preferences } from '@gemstack/framework'
import type { PreferenceSources } from '../lib/preferences.js'
import type { OptionRow } from './OptionsMenu.js'

/**
 * What this session will actually run with, inline under the launcher (#842).
 *
 * The options used to be invisible until you opened the gear, and the gear only ever showed your
 * own preferences. A repo's committed `the-framework.yml` is a layer too, so a value can be in
 * play that you never chose and the gear cannot change. Those are marked as the repo's, since
 * "not yours" is the part worth seeing.
 */
export function ResolvedOptions({
  options,
  sources,
  fileConfig,
}: {
  /** The same rows the gear renders, so the strip and the menu can never disagree. */
  options: OptionRow[]
  sources: PreferenceSources
  /** The repo file, for the keys with no preference counterpart: `preset` and `event`. */
  fileConfig: FrameworkFileConfig
}) {
  const on = options.filter(o => o.checked && !o.disabled)
  const chips = [
    ...(fileConfig.preset ? [{ key: 'preset', label: `preset: ${fileConfig.preset}`, repo: true }] : []),
    ...(fileConfig.event ? [{ key: 'event', label: `kind: ${fileConfig.event}`, repo: true }] : []),
    ...on.map(o => ({ key: o.key, label: o.label, repo: sources[o.key as keyof Preferences] === 'repo' })),
  ]
  if (!chips.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <span className="mr-0.5">In play:</span>
      {chips.map(chip => (
        <span
          key={chip.key}
          title={
            chip.repo
              ? 'From this repo’s the-framework.yml, committed for everyone who clones it'
              : 'Your setting, from the options gear'
          }
          className={
            chip.repo
              ? 'rounded border border-dashed border-border px-1.5 py-0.5'
              : 'rounded border border-transparent bg-muted px-1.5 py-0.5'
          }
        >
          {chip.label}
          {chip.repo && <span className="ml-1 opacity-70">repo</span>}
        </span>
      ))}
    </div>
  )
}
