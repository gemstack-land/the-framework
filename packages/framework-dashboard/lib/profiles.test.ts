import { afterEach, describe, expect, test } from 'vitest'
import {
  listProfiles,
  addProfile,
  removeProfile,
  parseDeviceUrl,
  connectUrl,
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
