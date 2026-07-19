import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRoute } from './use-route.js'

let urlPathname = '/'
const navigate = vi.fn()

vi.mock('vike-react/usePageContext', () => ({ usePageContext: () => ({ urlPathname }) }))
vi.mock('vike/client/router', () => ({ navigate: (...args: unknown[]) => navigate(...args) }))

describe('useRoute', () => {
  beforeEach(() => {
    urlPathname = '/'
    navigate.mockClear()
  })

  it('reads the route from the live URL, not the prerendered route params', () => {
    urlPathname = '/my-repo/run-1'
    expect(renderHook(() => useRoute()).result.current.route).toEqual({ projectId: 'my-repo', runId: 'run-1' })
  })

  it('navigates to a route', () => {
    const { result } = renderHook(() => useRoute())
    result.current.go({ projectId: 'my-repo', runId: 'run-1' })
    expect(navigate).toHaveBeenCalledWith('/my-repo/run-1', undefined)
  })

  it('replaces the history entry when asked', () => {
    const { result } = renderHook(() => useRoute())
    result.current.go({ projectId: 'my-repo', runId: null }, { replace: true })
    expect(navigate).toHaveBeenCalledWith('/my-repo', { overwriteLastHistoryEntry: true })
  })

  it('does not add a history entry for where it already is', () => {
    urlPathname = '/my-repo'
    const { result } = renderHook(() => useRoute())
    result.current.go({ projectId: 'my-repo', runId: null })
    expect(navigate).not.toHaveBeenCalled()
  })
})
