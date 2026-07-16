import { useState } from 'react'

// A useState whose value is mirrored to localStorage under `key`: it initializes from the
// stored value and persists on every set, clearing the key when set to null. `window` is
// absent during prerender (ssr:false), so reads and writes are guarded and no-op at build
// time. Used for the selected project, so a refresh returns to the same one (#475).
export function usePersistentState(key: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  )
  const set = (next: string | null) => {
    setValue(next)
    if (typeof window === 'undefined') return
    if (next === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, next)
  }
  return [value, set]
}
