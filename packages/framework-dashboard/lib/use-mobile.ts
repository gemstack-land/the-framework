import { useEffect, useState } from 'react'

// Below this the sidebar switches to an off-canvas Sheet (shadcn's default). matchMedia only runs
// in the effect, so the prerender (ssr:false) resolves to `false` and it flips in the browser.
const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    // Absent under prerender and in jsdom; default to not-mobile there rather than throwing.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
