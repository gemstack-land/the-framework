import type { ReactNode } from 'react'
import { cardStyle, CodeChip, SectionHead } from './ui'

const QUEUES: { title: string; paragraphs: ReactNode[] }[] = [
  {
    title: 'AI Queue',
    paragraphs: [
      'Queue of future AI tasks — tasks are added by humans, or by product management agents (autonomously if highly confident, or after your confirmation otherwise).',
      <>
        The AI autonomousity is essentially powered by agents autonomously populating the AI queue.
      </>,
      <>
        Technically, it's just a <CodeChip fontSize={12}>TODO_AGENTS.md</CodeChip> file in your Git repositories.
      </>,
    ],
  },
  {
    title: 'Human Queue',
    paragraphs: [
      'Queue of human reviews required — populated when agents ask you to review (important) decisions with subtle pros and cons.',
      "It's basically your cockpit that keeps you in control."
    ],
  },
]

export function Queues() {
  return (
    <section id="queues" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHead small title="Queues" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: 18,
        }}
      >
        {QUEUES.map((q) => (
          <div
            key={q.title}
            style={{ ...cardStyle, padding: 'clamp(16px, 4.5vw, 24px)', display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{q.title}</h4>
            {q.paragraphs.map((p, i) => (
              <p key={i} style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
