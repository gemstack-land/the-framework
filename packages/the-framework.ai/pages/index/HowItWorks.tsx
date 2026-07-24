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
        <p style={subStyle}>The Framework introduces:</p>
        <ol style={{ ...subStyle, paddingLeft: 24 }}>
          <li>"Enhanced System Prompt" — the system prompt owned by The Framework (and you)</li>
          <li>"Queues" — most notably the queue of AI tasks</li>
        </ol>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(44px, 8vw, 64px)' }}>
        <EnhancedSystemPrompt />
        <Prompts />
        <Queues />
      </div>
    </section>
  )
}
