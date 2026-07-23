import { useSyncExternalStore } from 'react'

// The saved device selected as this browser's run target (#1067). Ephemeral, in-memory only: a
// device's token is a per-browser secret, so which device a run goes to is transient UI state, never
// a persisted preference (that is why it is not in Preferences alongside `local`/`actions`). Null
// means a driver target (this machine / GitHub Actions) is selected. Node-free leaf like profiles.ts,
// so nothing leaks into the SPA bundle. The value is the device's profile id (its origin url).

let selectedDeviceId: string | null = null
const listeners = new Set<() => void>()

/** Select a saved device (by profile id) as the run target, or null to go back to a driver target. */
export function selectRemoteDevice(id: string | null): void {
  if (selectedDeviceId === id) return
  selectedDeviceId = id
  for (const listener of listeners) listener()
}

/** The selected device id, read at submit time to attach the run's relay target. */
export function getSelectedRemoteDeviceId(): string | null {
  return selectedDeviceId
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The selected device id as reactive state; null on the server and until a device is picked. */
export function useSelectedRemoteDeviceId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedRemoteDeviceId, () => null)
}
