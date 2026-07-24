import type { ReactNode } from 'react'
import { cardStyle, h3Style, kickerStyle, mono } from './ui'

const leadStyle = { color: '#d3c6aa', fontWeight: 600 } as const

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>{children}</p>
}

function QueueCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{ ...cardStyle, padding: 'clamp(16px, 4.5vw, 24px)', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{title}</h4>
      {children}
    </div>
  )
}

// The same tasks the DashboardMock shows — the file is where that queue lives.
function TodoAgentsMock() {
  const rows = [
    { done: true, text: 'Security audit' },
    { done: false, text: 'Refactor auth module' },
    { done: false, text: 'Spike: offline mode' },
  ]
  return (
    <div style={{ background: '#232a2e', border: '1px solid #3d484d', borderRadius: 8, overflow: 'hidden', fontFamily: mono }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderBottom: '1px solid #3d484d' }}>
        {['#e67e80', '#dbbc7f', '#a7c080'].map((c) => (
          <span key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
        ))}
        <span style={{ marginLeft: 8, fontSize: 11, color: '#859289' }}>TODO_AGENTS.md</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
        {rows.map((r) => (
          <div
            key={r.text}
            style={{
              color: r.done ? '#859289' : '#d3c6aa',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ color: r.done ? '#a7c080' : '#859289' }}>{r.done ? '- [x]' : '- [ ]'}</span> {r.text}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Queues() {
  return (
    <section id="queues" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={kickerStyle}>02</span>
        <h3 style={h3Style}>Queues</h3>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <QueueCard title="AI Queue">
          <P>
            <b style={leadStyle}>Queue of future AI tasks</b> — tasks are added by humans, or by product management
            agents (autonomously if highly confident, or after your confirmation otherwise).
          </P>
          <P>
            <b style={leadStyle}>Powers the AI autonomousity</b> — essentially driven by agents autonomously populating
            the AI queue.
          </P>
          <P>
            <b style={leadStyle}>On disk</b> — technically it's just a file in your Git repositories:
          </P>
          <TodoAgentsMock />
        </QueueCard>
        <QueueCard title="Human Queue">
          <P>
            <b style={leadStyle}>Queue of human reviews required</b> — populated when agents ask you to review
            (important) decisions with subtle pros and cons.
          </P>
          <P>
            <b style={leadStyle}>Your cockpit</b> — it's basically what keeps you in control.
          </P>
        </QueueCard>
      </div>
    </section>
  )
}
