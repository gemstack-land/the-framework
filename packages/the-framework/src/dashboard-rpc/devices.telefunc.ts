import { pingRemote } from '../dashboard/remote-run.js'

// The saved-devices health surface (#1072). The tokens live browser-side (per #1052), so the browser
// hands this daemon each device's {id, url, token} and the daemon does the cookie'd cross-origin
// ping; the token is used for the check and never persisted. Returns a reachable map the status dots
// read. No context needed: it acts only on what the browser passed, so it is inert on any host.

/** One device to health-check: its profile id plus the origin and token to reach it with. */
export interface DeviceCheck {
  id: string
  url: string
  token: string
}

function isDeviceCheck(value: unknown): value is DeviceCheck {
  const d = value as Partial<DeviceCheck> | null
  return !!d && typeof d.id === 'string' && typeof d.url === 'string' && typeof d.token === 'string'
}

/** Ping each saved device and map its id to whether it answered (#1072). Bad entries are dropped. */
export async function checkDevices(devices: DeviceCheck[]): Promise<Record<string, boolean>> {
  const valid = (Array.isArray(devices) ? devices : []).filter(isDeviceCheck)
  const entries = await Promise.all(valid.map(async d => [d.id, await pingRemote({ url: d.url, token: d.token })] as const))
  return Object.fromEntries(entries)
}
