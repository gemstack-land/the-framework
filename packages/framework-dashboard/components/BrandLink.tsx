import { Logo } from './Logo.js'

// The mark and the wordmark are the way home (#909): clicking them goes to `/`, the Overview.
//
// A real `<a href="/">` rather than a button, so cmd-click and middle-click open a second Overview
// and "copy link address" gives a URL. A plain left click is handled here instead, as a client-side
// navigation through the shell's own router (#784) — the same `go` every other selection uses.
export function BrandLink({ working, onNavigate }: { working: boolean; onNavigate: () => void }) {
  return (
    <a
      href="/"
      onClick={event => {
        // A modified click is the browser's to handle: a new tab, a new window, a download.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        onNavigate()
      }}
      className="flex shrink-0 items-center gap-3 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    >
      <Logo className="h-5 w-auto shrink-0" working={working} />
      <span className="shrink-0 font-semibold">The Framework</span>
    </a>
  )
}
