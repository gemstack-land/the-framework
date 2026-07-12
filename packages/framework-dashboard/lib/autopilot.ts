// The autopilot preference (#433), shared by the Start form's Global options and the
// choice-gate countdown so the two stay in lockstep, as the old page.ts did. Persisted in
// localStorage under the same `framework:autopilot` key; default on (the demo default).
// Guarded for prerender, where `window`/`localStorage` do not exist.
const KEY = 'framework:autopilot'

export function autopilotOn(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(KEY) !== '0' // absent (null) or anything but '0' -> on
}

export function setAutopilot(on: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, on ? '1' : '0')
}
