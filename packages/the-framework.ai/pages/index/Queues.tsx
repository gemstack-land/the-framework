import type { ReactNode } from 'react'
import { cardStyle, CodeChip, h3Style } from './ui'

const leadStyle = { color: '#d3c6aa', fontWeight: 600 } as const

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>{children}</p>
}

function QueueCard({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div
      style={{ ...cardStyle, padding: 'clamp(16px, 4.5vw, 24px)', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
        <span aria-hidden style={{ marginRight: 8 }}>
          {icon}
        </span>
        {title}
      </h4>
      {children}
    </div>
  )
}

export function Queues() {
  return (
    <section id="queues" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h3 style={h3Style}>2. Queues</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <QueueCard title="AI Queue" icon="🤖">
          <P>
            Queue of future AI tasks — tasks are added by humans, or by{' '}
            <a href="#autonomous-ai">product management agents</a> (autonomously if highly confident, or after your
            confirmation otherwise).
          </P>
          <P>
            <b style={leadStyle}>Powers the AI autonomousity</b> — essentially driven by agents autonomously populating
            the AI queue.
          </P>
          <P>
            Technically, it's just a <CodeChip fontSize={12}>TODO_AGENTS.md</CodeChip> file in your Git repositories.
          </P>
        </QueueCard>
        <QueueCard title="Human Queue" icon="🙋">
          <P>
            Queue of human reviews required — populated when agents ask you to review
            (important) decisions with subtle pros and cons.
          </P>
          <P>
            <a href="#features" style={{ fontWeight: 600 }}>
              Your cockpit
            </a>{' '}
            — it's basically what keeps you in control.
          </P>
        </QueueCard>
      </div>
    </section>
  )
}
