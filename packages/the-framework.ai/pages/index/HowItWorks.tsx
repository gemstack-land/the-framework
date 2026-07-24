import { SectionHead, sectionStyle } from './ui'
import { EnhancedSystemPrompt } from './EnhancedSystemPrompt'
import { Prompts } from './Prompts'
import { Queues } from './Queues'

export function HowItWorks() {
  return (
    <section id="how-it-works" style={sectionStyle}>
      <SectionHead title="How it works" sub="The Framework introduces two things:" />
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
