import { useEffect, type ReactNode } from 'react'
import './tailwind.css'
import { usePreferences, themePreference, resolvedDark } from '../lib/preferences.js'

// The dashboard's color theme (#725): system (default, follow the OS), light, or dark. Client-only
// (ssr:false), so toggling the `.dark` class in an effect is fine. Until the preferences load over
// Telefunc the choice is `system`, so a dark-OS user still gets dark first paint.
export default function LayoutDefault({ children }: { children: ReactNode }) {
  const theme = themePreference(usePreferences())
  useEffect(() => {
    const root = document.documentElement
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', resolvedDark(theme, mql.matches))
    apply()
    // Only follow live OS changes while on `system`; light/dark are fixed choices.
    if (theme !== 'system') return
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])
  return <div className="min-h-screen bg-background text-foreground">{children}</div>
}
