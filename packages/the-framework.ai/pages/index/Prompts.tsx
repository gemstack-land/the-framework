import type { CSSProperties } from 'react'
import { cardStyle } from './ui'

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

const chipStyle: CSSProperties = {
  borderRadius: 8,
  padding: '7px 14px',
  fontSize: 13.5,
  fontWeight: 500,
  color: '#d3c6aa',
}

// A demoted band, not a third pillar: one lead-in line and a chip per prompt
// pack, each full description tucked into its title tooltip.
export function Prompts() {
  return (
    <section id="prompts" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: '#9da9a0', textWrap: 'pretty' }}>
        <b style={{ color: '#d3c6aa', fontWeight: 600 }}>High-quality prompts</b> — state-of-the-art open source, or
        bring your own:
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {CARDS.map((c) => (
          <span key={c.title} title={c.desc} style={{ ...cardStyle, ...chipStyle }}>
            {c.title}
          </span>
        ))}
        <span
          title="Save your own tailored prompts."
          style={{ ...chipStyle, background: 'transparent', border: '1.5px dashed #4f585e', color: '#a7c080' }}
        >
          ＋ Add yours
        </span>
      </div>
    </section>
  )
}
