import { useCallback, useState } from 'react'

// The write-side twin of use-async's read hooks. Every mutation panel hand-rolled the same
// shape: flip a busy flag, clear the error, await the RPC, route a `{ ok: false, error }`
// result or a thrown error into an error string, and reset busy in a finally. That is this
// hook, once. `run` returns the RPC result on success (so the caller does only its success
// side) and `undefined` when the action did not succeed. `fallback` names the error for a
// thrown failure that carries no message of its own.
export function useAction(): {
  busy: boolean
  error: string | null
  reset: () => void
  run: <T>(fn: () => Promise<T>, fallback?: string) => Promise<T | undefined>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = useCallback(() => setError(null), [])

  const run = useCallback(async <T,>(fn: () => Promise<T>, fallback = 'Something went wrong.'): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      if (isFailure(result)) {
        setError(result.error ?? fallback)
        return undefined
      }
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, reset, run }
}

/** A telefunc mutation's failure branch: `{ ok: false, error }`. Void results are not failures. */
function isFailure(result: unknown): result is { ok: false; error?: string } {
  return typeof result === 'object' && result !== null && 'ok' in result && (result as { ok: unknown }).ok === false
}
