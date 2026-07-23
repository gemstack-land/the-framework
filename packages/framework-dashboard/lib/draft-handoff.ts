// The composer draft carried across a device hop (#1066). connectTo() appends `?draft=` alongside
// the token; the #1051 bootstrap 302 strips only `?token=`, so the draft lands on the remote SPA as
// `/?draft=…`. This moves it out of the URL into sessionStorage at boot so the typed prompt never
// sits in the address bar, history, or a Referer header, and the launcher rehydrates from it once.

/** sessionStorage key holding a draft carried from another device, until the launcher takes it. */
const PENDING_DRAFT_KEY = 'fw.pending-draft'

/** sessionStorage, or undefined during prerender (ssr:false) where there is no browser. */
function session(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/** At SPA boot: move `?draft=` out of the URL into sessionStorage and strip it from the address bar
 * (and so from history and any Referer). Idempotent and a no-op when there is no draft param. */
export function stashDraftFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const draft = url.searchParams.get('draft')
  if (draft === null) return
  session()?.setItem(PENDING_DRAFT_KEY, draft)
  url.searchParams.delete('draft')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/** The carried draft, if any, cleared as it is read so a reload does not re-seed it. */
export function takePendingDraft(): string | null {
  const s = session()
  if (!s) return null
  const draft = s.getItem(PENDING_DRAFT_KEY)
  if (draft !== null) s.removeItem(PENDING_DRAFT_KEY)
  return draft
}
