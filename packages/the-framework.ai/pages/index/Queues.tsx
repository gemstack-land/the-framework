import { cardStyle, SectionHead } from './ui'

const QUEUES = [
  {
    title: 'Human Queue',
    desc: 'Queue of human reviews required — agents ask you to review (important) decisions with subtle pros and cons.',
  },
  {
    title: 'AI Queue',
    desc: 'Queue of future AI tasks — tasks can be added by humans, or by product management agents (autonomously if highly confident, or after your confirmation otherwise).',
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
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>{q.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
