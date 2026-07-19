import { describe, it, expect } from 'vitest'
import { parseRoute, formatRoute } from './route.js'

describe('parseRoute', () => {
  it('reads the Overview from the root', () => {
    expect(parseRoute('/')).toEqual({ projectId: null, runId: null })
    expect(parseRoute('')).toEqual({ projectId: null, runId: null })
  })

  it('reads a project home', () => {
    expect(parseRoute('/my-repo-a1b2')).toEqual({ projectId: 'my-repo-a1b2', runId: null })
  })

  it('reads a session', () => {
    expect(parseRoute('/my-repo-a1b2/2026-07-19-1200-ab')).toEqual({
      projectId: 'my-repo-a1b2',
      runId: '2026-07-19-1200-ab',
    })
  })

  it('ignores a trailing slash and extra segments', () => {
    expect(parseRoute('/my-repo/run-1/')).toEqual({ projectId: 'my-repo', runId: 'run-1' })
    expect(parseRoute('/my-repo/run-1/whatever')).toEqual({ projectId: 'my-repo', runId: 'run-1' })
  })

  it('decodes segments, and keeps a malformed one as typed', () => {
    expect(parseRoute('/a%20b/c%2Fd')).toEqual({ projectId: 'a b', runId: 'c/d' })
    expect(parseRoute('/%E0%A4%A')).toEqual({ projectId: '%E0%A4%A', runId: null })
  })
})

describe('formatRoute', () => {
  it('writes each route', () => {
    expect(formatRoute({ projectId: null, runId: null })).toBe('/')
    expect(formatRoute({ projectId: 'my-repo', runId: null })).toBe('/my-repo')
    expect(formatRoute({ projectId: 'my-repo', runId: 'run-1' })).toBe('/my-repo/run-1')
  })

  it('has no session without a project', () => {
    expect(formatRoute({ projectId: null, runId: 'run-1' })).toBe('/')
  })

  it('encodes segments', () => {
    expect(formatRoute({ projectId: 'a b', runId: 'c/d' })).toBe('/a%20b/c%2Fd')
  })

  it('round-trips', () => {
    for (const route of [
      { projectId: null, runId: null },
      { projectId: 'my-repo', runId: null },
      { projectId: 'my-repo', runId: 'run-1' },
      { projectId: 'a b', runId: 'c/d' },
    ]) {
      expect(parseRoute(formatRoute(route))).toEqual(route)
    }
  })
})
