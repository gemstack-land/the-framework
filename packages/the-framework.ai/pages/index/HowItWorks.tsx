import { h2Style, sectionStyle } from './ui'
import { EnhancedSystemPrompt } from './EnhancedSystemPrompt'
import { Prompts } from './Prompts'
import { Queues } from './Queues'

const subStyle = { margin: 0, fontSize: 17, lineHeight: 1.6, color: '#9da9a0' } as const

export function HowItWorks() {
  return (
    <section id="how-it-works" style={sectionStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        <h2 style={h2Style}>How it works</h2>
        <p style={subStyle}>The Framework introduces two things:</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(44px, 8vw, 64px)' }}>
        {/* The two introduced things side by side, in the subtext's enumeration order. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
            gap: 'clamp(44px, 8vw, 64px) clamp(28px, 5vw, 48px)',
            alignItems: 'start',
          }}
        >
          <EnhancedSystemPrompt />
          <Queues />
        </div>
        <Prompts />
      </div>
    </section>
  )
}
