import { useState } from 'react'

// The run Context set (#492/#504): the file/repo paths the user picked to focus the agent,
// with immutable add/toggle so React sees a fresh Set on each change. Owned by the shell so
// the Start form's `#`/whole-repo picker and the right-rail file tree share one source of
// truth; `reset()` clears it when the selected project changes (its paths were that project's).
export function useContextSet(): {
  context: Set<string>
  add: (path: string) => void
  toggle: (path: string) => void
  reset: () => void
} {
  const [context, setContext] = useState<Set<string>>(new Set())
  const add = (path: string) => setContext(prev => (prev.has(path) ? prev : new Set(prev).add(path)))
  const toggle = (path: string) =>
    setContext(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  const reset = () => setContext(new Set())
  return { context, add, toggle, reset }
}
