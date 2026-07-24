import type { CSSProperties } from 'react'
import { cardStyle, SectionHead } from './ui'

const CARDS = [
  { title: 'Security audit', desc: 'Prompts that scrutinize your code for security vulnerabilities.' },
  {
    title: 'Code quality',
    desc: 'Prompts improving maintainability (e.g. DRY and simplicity), as well as making code more human readable.',
  },
  { title: 'Research', desc: 'Prompts for planning complex implementations, market research, and more.' },
  {
    title: 'Product Management',
    desc: 'Prompts for managing tickets (spiking & planning, creating tickets from team conversations), creating roadmaps, suggesting new features, and more.',
  },
]

const promptCardStyle: CSSProperties = {
  padding: 'clamp(16px, 4.5vw, 24px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

export function Prompts() {
  return (
    <section id="prompts" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHead small title="High-quality prompts" sub="Powered by state-of-the-art open source prompts, or bring your own." />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
          gap: 18,
        }}
      >
        {CARDS.map((c) => (
          <div key={c.title} style={{ ...cardStyle, ...promptCardStyle }}>
            <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{c.title}</h4>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>{c.desc}</p>
          </div>
        ))}
        <div style={{ background: 'transparent', border: '1.5px dashed #4f585e', borderRadius: 12, ...promptCardStyle }}>
          <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#a7c080' }}>＋ Add yours</h4>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>Save your own tailored prompts.</p>
        </div>
      </div>
    </section>
  )
}
