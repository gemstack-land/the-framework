import { useSyncExternalStore } from 'react'

// Client connection profiles (#1052): the saved daemons this browser can hop to. "A device I have"
// is a CONNECTION, not a run driver — the SPA is served by its daemon and every transport is
// same-origin, so switching devices means navigating the browser to that daemon's origin, where the
// #1051 bootstrap sets the fw_daemon cookie from `?token=` and everything is same-origin again.
//
// Storage is client-side localStorage on purpose: the token is a per-browser secret, so it must
// never reach the daemon's registry file (the wrong home, shared across browsers). Node-free leaf
// like agent-names.ts / preference-defaults.ts, so nothing node leaks into the SPA bundle.

/** A saved daemon this browser can connect to. `token` is empty only for the loopback Local one. */
export type ConnectionProfile = { id: string; label: string; url: string; token: string }

/** localStorage key for the saved remote devices (an array of {@link ConnectionProfile}). */
const DEVICES_KEY = 'fw.devices'

/** localStorage key remembering the loopback origin the dashboard was launched from (#1052), so
 * "Local" returns to the right port even from a remote box. */
const LOCAL_ORIGIN_KEY = 'fw.local-origin'

/** Fallback loopback origin when none was remembered — the default daemon port (daemon.ts). */
const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:4200'

/** localStorage, or undefined during prerender (ssr:false) where there is no browser. */
function store(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function isProfile(value: unknown): value is ConnectionProfile {
  const p = value as Partial<ConnectionProfile> | null
  return !!p && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.url === 'string' && typeof p.token === 'string'
}

/** The saved remote devices, newest first, filtered to well-formed entries. */
export function listProfiles(): ConnectionProfile[] {
  try {
    const raw = store()?.getItem(DEVICES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isProfile) : []
  } catch {
    return []
  }
}

function writeProfiles(list: ConnectionProfile[]): void {
  store()?.setItem(DEVICES_KEY, JSON.stringify(list))
  notify()
}

/** Save (or update, keyed by origin) a device. Returns the stored profile. A repeat paste of the
 * same box refreshes its token rather than stacking a duplicate. */
export function addProfile(input: { url: string; token: string; label?: string }): ConnectionProfile {
  const profile: ConnectionProfile = {
    id: input.url,
    label: input.label?.trim() || hostLabel(input.url),
    url: input.url,
    token: input.token,
  }
  writeProfiles([profile, ...listProfiles().filter(p => p.id !== profile.id)])
  return profile
}

/** Drop a saved device by id. */
export function removeProfile(id: string): void {
  writeProfiles(listProfiles().filter(p => p.id !== id))
}

/** The origin's host as a fallback label (e.g. `192.168.1.5:4200`) when none was given. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Pull the origin and token out of the full `http://host:port/?token=…` URL the box prints on its
 * non-loopback bind (cli.ts). Returns null if the paste is not a URL. The url is normalized to the
 * bare origin so it matches `window.location.origin` for the connected indicator.
 */
export function parseDeviceUrl(pasted: string): { url: string; token: string } | null {
  try {
    const u = new URL(pasted.trim())
    return { url: u.origin, token: u.searchParams.get('token') ?? '' }
  } catch {
    return null
  }
}

/** Whether a host is loopback (so the dashboard is talking to this machine's own daemon). */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

/** Remember the loopback origin the dashboard is served from, so "Local" can return to the right
 * port from a remote box. A no-op off loopback. */
export function rememberLocalOrigin(origin: string, host: string): void {
  if (isLoopbackHost(host)) store()?.setItem(LOCAL_ORIGIN_KEY, origin)
}

/** The loopback origin to send "Local" to: the remembered launch origin, else the default port. */
export function localOrigin(): string {
  return store()?.getItem(LOCAL_ORIGIN_KEY) ?? DEFAULT_LOCAL_ORIGIN
}

/** The connect URL for a device: its origin plus the token for the one bootstrap hop (#1051). */
export function connectUrl(profile: Pick<ConnectionProfile, 'url' | 'token'>): string {
  return profile.token ? `${profile.url}/?token=${encodeURIComponent(profile.token)}` : profile.url
}

/** Navigate the browser to a saved device (carrying its token). This is the connection hop, NOT a
 * run submit: the remote SPA re-authenticates same-origin from the cookie the bootstrap sets. */
export function connectTo(profile: ConnectionProfile): void {
  globalThis.location?.assign(connectUrl(profile))
}

/** Navigate back to this machine's own loopback daemon (no token). */
export function connectLocal(): void {
  globalThis.location?.assign(localOrigin())
}

/** Which daemon the dashboard is currently talking to, for the connected indicator. Loopback = the
 * local machine; else the matching saved device's label, or the bare host if it is unsaved. */
export function currentConnection(profiles: ConnectionProfile[], origin: string, host: string): { label: string; isLocal: boolean } {
  if (isLoopbackHost(host)) return { label: 'Local', isLocal: true }
  return { label: profiles.find(p => p.url === origin)?.label ?? host, isLocal: false }
}

// A tiny store so the gear and the connected indicator re-render when devices change. localStorage
// has no in-tab change event, so writes notify explicitly; the snapshot is cached until then
// (useSyncExternalStore compares by identity, so re-reading fresh each call would loop).
let snapshotCache: ConnectionProfile[] | null = null
const listeners = new Set<() => void>()

function notify(): void {
  snapshotCache = null
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ConnectionProfile[] {
  return (snapshotCache ??= listProfiles())
}

/** The saved devices as reactive state. Prerender has no localStorage, so it renders the empty list
 * and the real one loads on the client. */
export function useConnectionProfiles(): ConnectionProfile[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}

const EMPTY: ConnectionProfile[] = []
