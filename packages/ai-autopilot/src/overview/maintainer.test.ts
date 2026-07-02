import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CodeOverviewMaintainer, createOverviewMaintainer } from './maintainer.js'
import { serializeOverview } from './markdown.js'
import { OVERVIEW_FILE } from './store.js'
import type { CodeOverview, OverviewEvent, OverviewFs, RegenerateContext } from './types.js'

/** An in-memory {@link OverviewFs} for tests. */
function memFs(seed: Record<string, string> = {}): OverviewFs & { files: Record<string, string> } {
  const files = { ...seed }
  return {
    files,
    async read(path) {
      const v = files[path]
      if (v === undefined) throw new Error(`no such file: ${path}`)
      return v
    },
    async write(path, contents) {
      files[path] = contents
    },
    async exists(path) {
      return path in files
    },
  }
}

const overviewOf = (summary: string): CodeOverview => ({ summary, sections: [] })

describe('CodeOverviewMaintainer — material gating', () => {
  it('regenerates + persists on a material change', async () => {
    const calls: RegenerateContext[] = []
    const fs = memFs()
    const maintainer = new CodeOverviewMaintainer({
      fs,
      regenerate: ctx => {
        calls.push(ctx)
        return overviewOf('fresh map')
      },
    })
    const refresh = await maintainer.handle({ kind: 'major-change', summary: 'migrated to vitest', paths: ['vitest.config.ts'] })

    assert.equal(refresh.refreshed, true)
    assert.match(refresh.reasons.join(), /test-tooling/)
    assert.equal(maintainer.get()?.summary, 'fresh map')
    assert.equal(fs.files[OVERVIEW_FILE], serializeOverview(overviewOf('fresh map')))
    assert.match(calls[0]!.reason, /test-tooling/) // reason threaded to regenerate
  })

  it('skips an immaterial change — no regenerate, overview untouched', async () => {
    let regenerated = 0
    const maintainer = new CodeOverviewMaintainer({
      overview: overviewOf('existing'),
      regenerate: () => { regenerated++; return overviewOf('should not happen') },
    })
    const refresh = await maintainer.handle({ kind: 'major-change', summary: 'fix a typo', paths: ['src/x.ts'] })

    assert.equal(refresh.refreshed, false)
    assert.deepEqual(refresh.reasons, [])
    assert.equal(refresh.overview?.summary, 'existing')
    assert.equal(regenerated, 0)
  })

  it('passes the previous overview into regenerate so it revises rather than rewrites', async () => {
    let seenPrevious: CodeOverview | undefined
    const maintainer = new CodeOverviewMaintainer({
      overview: overviewOf('v1'),
      regenerate: ctx => { seenPrevious = ctx.previous; return overviewOf('v2') },
    })
    await maintainer.handle({ kind: 'major-change', paths: ['package.json'] })
    assert.equal(seenPrevious?.summary, 'v1')
  })
})

describe('CodeOverviewMaintainer — generate + load + persistence', () => {
  it('generate() regenerates unconditionally (on-demand) and persists', async () => {
    const fs = memFs()
    const events: OverviewEvent[] = []
    const maintainer = createOverviewMaintainer({
      fs,
      regenerate: () => overviewOf('generated'),
      onEvent: e => events.push(e),
    })
    const overview = await maintainer.generate()
    assert.equal(overview.summary, 'generated')
    assert.ok(OVERVIEW_FILE in fs.files)
    assert.ok(events.some(e => e.type === 'generated'))
  })

  it('load() reads an existing CODE-OVERVIEW.md from the fs', async () => {
    const fs = memFs({ [OVERVIEW_FILE]: serializeOverview(overviewOf('from disk')) })
    const maintainer = new CodeOverviewMaintainer({ fs, regenerate: () => overviewOf('x') })
    assert.equal(maintainer.get(), undefined)
    await maintainer.load()
    assert.equal(maintainer.get()?.summary, 'from disk')
  })

  it('isolates a throwing onEvent callback', async () => {
    const maintainer = new CodeOverviewMaintainer({
      regenerate: () => overviewOf('ok'),
      onEvent: () => { throw new Error('observer bug') },
    })
    await maintainer.handle({ kind: 'major-change', paths: ['package.json'] })
    assert.equal(maintainer.get()?.summary, 'ok')
  })

  it('requires a regenerate function', () => {
    // @ts-expect-error missing regenerate
    assert.throws(() => new CodeOverviewMaintainer({}), /requires a `regenerate`/)
  })
})
