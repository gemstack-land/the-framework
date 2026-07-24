import '../index/styles.css'
import { mono } from '../index/ui'

// A 1200x630 banner (the Open Graph image size), rendered for screenshotting —
// no site chrome on purpose.
export default function Page() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        background: '#2d353b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 30,
        color: '#d3c6aa',
      }}
    >
      <img src="/assets/logo.svg" alt="" style={{ width: 128, height: 145 }} />
      <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-0.015em' }}>The Framework</div>
      <div style={{ fontSize: 27, color: '#9da9a0' }}>Make the important decisions, let AI do the rest.</div>
      <div style={{ fontFamily: mono, fontSize: 20, color: '#859289', marginTop: 14 }}>the-framework.ai</div>
    </div>
  )
}
