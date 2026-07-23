import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  listProfiles,
  addProfile,
  removeProfile,
  parseDeviceUrl,
  connectUrl,
  connectTo,
  currentConnection,
  isLoopbackHost,
  localOrigin,
  rememberLocalOrigin,
} from './profiles.js'

// jsdom provides a real localStorage, so these round-trip through it directly.
afterEach(() => localStorage.clear())

describe('profiles.ts (#1052)', () => {
  test('add / list / remove round-trips through localStorage', () => {
    expect(listProfiles()).toEqual([])
    const a = addProfile({ url: 'http://192.168.1.5:4200', token: 'aaa', label: 'Studio' })
    const b = addProfile({ url: 'http://box.tail.ts:4200', token: 'bbb' })
    expect(listProfiles().map(p => p.label)).toEqual(['box.tail.ts:4200', 'Studio']) // newest first
    expect(b.label).toBe('box.tail.ts:4200') // falls back to the host
    removeProfile(a.id)
    expect(listProfiles().map(p => p.id)).toEqual([b.id])
  })

  test('re-adding the same origin refreshes rather than duplicates', () => {
    addProfile({ url: 'http://192.168.1.5:4200', token: 'old', label: 'Studio' })
    addProfile({ url: 'http://192.168.1.5:4200', token: 'new' })
    const list = listProfiles()
    expect(list).toHaveLength(1)
    expect(list[0]!.token).toBe('new')
  })

  test('profiles survive a reload (a fresh read of localStorage)', () => {
    addProfile({ url: 'http://192.168.1.5:4200', token: 'aaa' })
    // Nothing cached across a real navigation — read straight from storage.
    const reread = JSON.parse(localStorage.getItem('fw.devices')!)
    expect(reread[0].token).toBe('aaa')
  })

  test('parseDeviceUrl pulls the origin and token out of a pasted URL', () => {
    expect(parseDeviceUrl('http://192.168.1.5:4200/?token=abc123')).toEqual({ url: 'http://192.168.1.5:4200', token: 'abc123' })
    expect(parseDeviceUrl('  http://box:4200/some/path?token=xyz  ')).toEqual({ url: 'http://box:4200', token: 'xyz' })
    expect(parseDeviceUrl('http://box:4200')).toEqual({ url: 'http://box:4200', token: '' })
    expect(parseDeviceUrl('not a url')).toBeNull()
  })

  test('connectUrl carries the token for the bootstrap hop', () => {
    expect(connectUrl({ url: 'http://box:4200', token: 'abc' })).toBe('http://box:4200/?token=abc')
    expect(connectUrl({ url: 'http://127.0.0.1:4200', token: '' })).toBe('http://127.0.0.1:4200') // Local, no token
  })

  test('connectUrl carries the composer draft alongside the token (#1066)', () => {
    expect(connectUrl({ url: 'http://box:4200', token: 'abc' }, 'ship it')).toBe('http://box:4200/?token=abc&draft=ship%20it')
    // No token (Local): the draft still rides.
    expect(connectUrl({ url: 'http://127.0.0.1:4200', token: '' }, 'hi')).toBe('http://127.0.0.1:4200/?draft=hi')
    // An oversize draft is dropped so it can't blow the URL length; the hop still connects.
    expect(connectUrl({ url: 'http://box:4200', token: 'abc' }, 'x'.repeat(8000))).toBe('http://box:4200/?token=abc')
  })

  test('connectTo navigates carrying the token and the draft (#1066)', () => {
    // jsdom won't let location.assign be redefined, so stub the whole location the code reads.
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    connectTo({ id: 'x', label: 'Studio', url: 'http://box:4200', token: 'abc' }, 'my prompt')
    expect(assign).toHaveBeenCalledTimes(1)
    const url = assign.mock.calls[0]![0] as string
    expect(url).toContain('token=abc')
    expect(url).toContain('draft=' + encodeURIComponent('my prompt'))
    vi.unstubAllGlobals()
  })

  test('isLoopbackHost knows the local machine', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('192.168.1.5')).toBe(false)
  })

  test('currentConnection labels the daemon the browser is on', () => {
    const profiles = [{ id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200', token: 'aaa' }]
    expect(currentConnection(profiles, 'http://127.0.0.1:4200', '127.0.0.1')).toEqual({ label: 'Local', isLocal: true })
    expect(currentConnection(profiles, 'http://192.168.1.5:4200', '192.168.1.5')).toEqual({ label: 'Studio', isLocal: false })
    expect(currentConnection(profiles, 'http://10.0.0.9:4200', '10.0.0.9')).toEqual({ label: '10.0.0.9', isLocal: false }) // unsaved
  })

  test('localOrigin returns the remembered loopback origin, else the default', () => {
    expect(localOrigin()).toBe('http://127.0.0.1:4200')
    rememberLocalOrigin('http://localhost:9999', 'localhost')
    expect(localOrigin()).toBe('http://localhost:9999')
    rememberLocalOrigin('http://192.168.1.5:4200', '192.168.1.5') // ignored off loopback
    expect(localOrigin()).toBe('http://localhost:9999')
  })
})
