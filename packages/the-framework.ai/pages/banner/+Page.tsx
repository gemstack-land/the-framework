import '../index/styles.css'
import { mono } from '../index/ui'

const BADGES = [
  ['100% Open Source', '#a7c080'],
  ['100% Free', '#dbbc7f'],
  ['100% Local', '#7fbbb3'],
] as const

// A 1200x630 banner (the Open Graph image size), rendered for screenshotting —
// no site chrome on purpose. Sized to stay legible at ~40% scale (X/Slack
// cards) with >=64px safe margins all around.
export default function Page() {
  return (
    <div
      style={{
        position: 'relative',
        width: 1200,
        height: 630,
        background: '#2d353b',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 48,
        padding: '64px 88px',
        boxSizing: 'border-box',
        color: '#d3c6aa',
      }}
    >
      {/* Soft glows so the background doesn't read as a flat void. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -140,
          top: -160,
          width: 720,
          height: 720,
          background: 'radial-gradient(circle, rgba(167, 192, 128, 0.09) 0%, rgba(167, 192, 128, 0) 62%)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: -180,
          bottom: -260,
          width: 640,
          height: 640,
          background: 'radial-gradient(circle, rgba(127, 187, 179, 0.06) 0%, rgba(127, 187, 179, 0) 60%)',
        }}
      />

      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ fontSize: 21, fontWeight: 600, color: '#9da9a0', letterSpacing: '0.01em' }}>The Framework</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ position: 'relative', alignSelf: 'flex-start', fontSize: 40, fontWeight: 500, color: '#9da9a0' }}>
            Babysit AI
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: '-3%',
                top: '58%',
                width: '106%',
                height: 5,
                borderRadius: 3,
                background: '#e67e80',
                transform: 'rotate(-5deg)',
              }}
            />
          </span>
          <div style={{ fontSize: 79, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, whiteSpace: 'nowrap' }}>
            Autonomous AI
          </div>
        </div>
        <div style={{ fontSize: 31, color: '#9da9a0', lineHeight: 1.4 }}>
          Make the important decisions,
          <br />
          let AI do the rest.
        </div>
        <div style={{ display: 'flex', gap: 13, fontFamily: mono, fontSize: 16.5, marginTop: 8 }}>
          {BADGES.map(([label, color]) => (
            <span
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                border: '1px solid #475258',
                borderRadius: 999,
                padding: '8px 17px',
                color,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <img src="/assets/logo.svg" alt="" style={{ position: 'relative', width: 360, height: 408, flex: 'none' }} />
    </div>
  )
}
