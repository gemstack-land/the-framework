import type { ReactNode } from 'react'
import type { EmojiChar } from './ui'
import { cardStyle, CodeChip, Emoji, h3Style } from './ui'

const leadStyle = { color: '#d3c6aa', fontWeight: 600 } as const

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>{children}</p>
}

function QueueCard({ title, icon, children }: { title: string; icon: EmojiChar; children: ReactNode }) {
  return (
    <div
      style={{ ...cardStyle, padding: 'clamp(16px, 4.5vw, 24px)', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
        {title}{' '}
        <span aria-hidden style={{ marginLeft: 4, verticalAlign: 2 }}>
          <Emoji e={icon} />
        </span>
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
            product management agents (autonomously if highly confident, or after your
            confirmation otherwise).
          </P>
          <P>
            <a href="#autonomous-ai" style={{ fontWeight: 600 }}>Powers the AI autonomousity</a> — essentially driven by agents autonomously populating
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
