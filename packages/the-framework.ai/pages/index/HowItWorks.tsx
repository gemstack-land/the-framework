import { SectionHead, sectionStyle } from './ui'
import { EnhancedSystemPrompt } from './EnhancedSystemPrompt'
import { Prompts } from './Prompts'
import { Queues } from './Queues'

export function HowItWorks() {
  return (
    <section id="how-it-works" style={sectionStyle}>
      <SectionHead title="How it works" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(44px, 8vw, 64px)' }}>
        <EnhancedSystemPrompt />
        <Prompts />
        <Queues />
      </div>
    </section>
  )
}
