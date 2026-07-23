import { afterEach, describe, expect, test } from 'vitest'
import { stashDraftFromUrl, takePendingDraft } from './draft-handoff.js'

// jsdom provides sessionStorage, window.location and history.replaceState, so these round-trip real.
afterEach(() => {
  sessionStorage.clear()
  history.replaceState(null, '', '/')
})

describe('draft-handoff (#1066)', () => {
  test('stashDraftFromUrl moves ?draft= into sessionStorage and strips it from the URL', () => {
    history.replaceState(null, '', '/?draft=' + encodeURIComponent('ship the thing') + '&keep=1')
    stashDraftFromUrl()
    expect(sessionStorage.getItem('fw.pending-draft')).toBe('ship the thing')
    // The prompt leaves the address bar (and so history + Referer); other params stay.
    expect(window.location.search).toBe('?keep=1')
  })

  test('takePendingDraft returns then clears the stash', () => {
    history.replaceState(null, '', '/?draft=hello')
    stashDraftFromUrl()
    expect(takePendingDraft()).toBe('hello')
    expect(takePendingDraft()).toBeNull() // cleared, so a reload does not re-seed it
  })

  test('no draft param is a no-op that leaves the URL alone', () => {
    history.replaceState(null, '', '/?other=1')
    stashDraftFromUrl()
    expect(takePendingDraft()).toBeNull()
    expect(window.location.search).toBe('?other=1')
  })
})
