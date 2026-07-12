import { useEffect, type ReactNode } from 'react'
import './tailwind.css'

// The Framework's MVP page is dark-first; match it so the spike reads as the same
// product. Client-only (ssr:false), so toggling the class in an effect is fine.
export default function LayoutDefault({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])
  return <div className="min-h-screen bg-background text-foreground">{children}</div>
}
