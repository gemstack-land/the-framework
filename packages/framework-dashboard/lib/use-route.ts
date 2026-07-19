import { usePageContext } from 'vike-react/usePageContext'
import { navigate } from 'vike/client/router'
import { parseRoute, formatRoute, type Route } from './route.js'

// The route as state (#784): read the current one, go to another. Vike's client router owns the
// URL, so Back/Forward are free and a session is a link you can paste, reload, and open twice.
//
// It reads `urlPathname`, not the route's `routeParams`: the shell is prerendered for `/` (ssr:false,
// one static index.html the daemon serves for every path), so the params baked into it are the
// build-time ones and never change, while `urlPathname` tracks the browser on both a hard load and
// a client navigation. Hence the catch-all `+route.ts` — it exists so a navigation to any path
// resolves to this page, and nothing reads what it returns.

export function useRoute(): {
  route: Route
  /** Navigate to `next`. Replaces the current history entry when `replace` is set — for a correction
   *  (adopting a started run's id), not a step you should be able to go Back to. */
  go: (next: Route, options?: { replace?: boolean }) => void
} {
  const { urlPathname } = usePageContext()
  const route = parseRoute(urlPathname)

  const go = (next: Route, options?: { replace?: boolean }) => {
    const url = formatRoute(next)
    // Going where you already are is not a history entry.
    if (url === urlPathname) return
    void navigate(url, options?.replace ? { overwriteLastHistoryEntry: true } : undefined)
  }

  return { route, go }
}
