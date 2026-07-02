import type { LoopEvent } from '../loop/types.js'
import { detectMaterialChange } from './material.js'
import { loadOverview, saveOverview, OVERVIEW_FILE } from './store.js'
import type {
  CodeOverview,
  MaterialChange,
  OverviewEvent,
  OverviewFs,
  OverviewRefresh,
  Regenerate,
} from './types.js'

/** Options for {@link CodeOverviewMaintainer}. */
export interface MaintainerOptions {
  /** Produce a fresh overview. Injected — usually `agentOverview(agent)`. */
  regenerate: Regenerate
  /** Seed the current overview (e.g. a just-loaded one). */
  overview?: CodeOverview
  /** Decide whether a change is material. Default {@link detectMaterialChange}. */
  detect?: (event: LoopEvent) => MaterialChange
  /** Persist the overview here when set (host or a runner session's `fs`). */
  fs?: OverviewFs
  /** Overview file path when persisting. Default `CODE-OVERVIEW.md`. */
  path?: string
  /** Observe progress. Isolated: a throwing callback is logged and swallowed. */
  onEvent?: (event: OverviewEvent) => void
}

/**
 * Owns the overview's maintenance policy: it holds the current {@link CodeOverview},
 * regenerates it on demand, and — the point of scale mode — refreshes it only
 * when a change is *material*. Feed it loop events via {@link handle} (wire it into
 * the loop with `overviewLoopPrompt`) and it self-maintains; immaterial edits are
 * skipped so the map does not churn on every commit.
 *
 * ```ts
 * const maintainer = new CodeOverviewMaintainer({ regenerate: agentOverview(agent), fs: nodeOverviewFs() })
 * await maintainer.load()
 * await maintainer.handle({ kind: 'major-change', summary: 'migrated to vitest', paths: ['vitest.config.ts'] })
 * ```
 */
export class CodeOverviewMaintainer {
  private overview?: CodeOverview
  private readonly regenerate: Regenerate
  private readonly detect: (event: LoopEvent) => MaterialChange
  private readonly fs?: OverviewFs
  private readonly path: string
  private readonly emit: (event: OverviewEvent) => void

  constructor(opts: MaintainerOptions) {
    if (typeof opts?.regenerate !== 'function') {
      throw new TypeError('[ai-autopilot] CodeOverviewMaintainer requires a `regenerate` function')
    }
    this.regenerate = opts.regenerate
    if (opts.overview) this.overview = opts.overview
    this.detect = opts.detect ?? (event => detectMaterialChange(event))
    if (opts.fs) this.fs = opts.fs
    this.path = opts.path ?? OVERVIEW_FILE
    this.emit = makeEmitter(opts.onEvent)
  }

  /** The current overview, or `undefined` if none has been generated/loaded. */
  get(): CodeOverview | undefined {
    return this.overview
  }

  /** Load the overview from the configured `fs` (no-op when no `fs` or no file). */
  async load(): Promise<CodeOverview | undefined> {
    if (!this.fs) return this.overview
    const loaded = await loadOverview(this.fs, this.path)
    if (loaded) this.overview = loaded
    return this.overview
  }

  /** Regenerate the overview unconditionally (the on-demand path) and persist it. */
  async generate(reason = 'on-demand', event?: LoopEvent): Promise<CodeOverview> {
    const overview = await this.regenerate({
      reason,
      ...(this.overview ? { previous: this.overview } : {}),
      ...(event ? { event } : {}),
    })
    this.overview = overview
    await this.persist()
    this.emit({ type: 'generated', reason })
    return overview
  }

  /**
   * Feed a change to the maintainer. Regenerates + persists only when the change
   * is material (see {@link detectMaterialChange}); otherwise it is skipped and
   * the overview is left untouched.
   */
  async handle(event: LoopEvent): Promise<OverviewRefresh> {
    const verdict = this.detect(event)
    if (!verdict.material) {
      this.emit({ type: 'skip', event })
      return { refreshed: false, reasons: [], ...(this.overview ? { overview: this.overview } : {}) }
    }
    this.emit({ type: 'refresh', reasons: verdict.reasons })
    const overview = await this.regenerate({
      reason: verdict.reasons.join('; '),
      event,
      ...(this.overview ? { previous: this.overview } : {}),
    })
    this.overview = overview
    await this.persist()
    return { refreshed: true, reasons: verdict.reasons, overview }
  }

  private async persist(): Promise<void> {
    if (this.fs && this.overview) await saveOverview(this.fs, this.overview, this.path)
  }
}

/** Factory mirror of `new CodeOverviewMaintainer(...)`. */
export function createOverviewMaintainer(opts: MaintainerOptions): CodeOverviewMaintainer {
  return new CodeOverviewMaintainer(opts)
}

function makeEmitter(onEvent: MaintainerOptions['onEvent']): (event: OverviewEvent) => void {
  if (!onEvent) return () => {}
  return event => {
    try {
      onEvent(event)
    } catch (err) {
      console.error('[ai-autopilot] overview onEvent callback threw; ignoring:', err)
    }
  }
}
