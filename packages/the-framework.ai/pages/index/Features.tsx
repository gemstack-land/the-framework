import type { ReactNode } from 'react'
import { cardStyle, mono, Note, SectionHead, sectionStyle, WipBadge } from './ui'

const featureCardStyle = {
  ...cardStyle,
  padding: 'clamp(18px, 4vw, 26px) clamp(16px, 4.5vw, 28px)',
  display: 'flex',
  flexDirection: 'column',
} as const

function FeatureText({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#9da9a0' }}>{children}</p>
}

function DashboardMock() {
  const rows = [
    ['▸ refactor auth module', 'running', '#7fbbb3'],
    ['▸ spike: offline mode', 'queued', '#859289'],
    ['▸ security audit', 'queued', '#859289'],
    ['▸ ticket triage (12 new)', 'needs review', '#dbbc7f'],
  ] as const
  return (
    <div style={{ background: '#232a2e', border: '1px solid #3d484d', borderRadius: 10, overflow: 'hidden', fontFamily: mono }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid #3d484d' }}>
        {['#e67e80', '#dbbc7f', '#a7c080'].map((c) => (
          <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
        ))}
        <span style={{ marginLeft: 10, fontSize: 11, color: '#859289' }}>framework — dashboard</span>
      </div>
      <div
        style={{
          padding: 'clamp(12px, 3vw, 16px) clamp(12px, 3vw, 18px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#859289' }}>
            <span>usage quota (pro-rata)</span>
            <span style={{ color: '#a7c080' }}>62%</span>
          </div>
          <div style={{ height: 6, background: '#343f44', borderRadius: 3 }}>
            <div style={{ height: 6, width: '62%', background: '#a7c080', borderRadius: 3 }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          {rows.map(([name, status, color]) => (
            <div key={name} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
              <span style={{ color: '#d3c6aa' }}>{name}</span>
              <span style={{ color }}>{status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Features() {
  return (
    <section id="features" style={sectionStyle}>
      <SectionHead title="Features" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ ...featureCardStyle, gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>Bring your own subscription</h3>
            <FeatureText>
              Use your existing AI subscription — The Framework orchestrates agents via your Claude Code / Codex
              installation.
            </FeatureText>
            <Note label={<WipBadge style={{ marginRight: 8, display: 'inline-block' }} />}>
              Claude Code Web: orchestrate agents via Claude Code Web for 0% local CPU usage.
            </Note>
          </div>
          <div style={{ ...featureCardStyle, gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>Notifications</h3>
            <FeatureText>Get notified when AI is finished or needs you.</FeatureText>
          </div>
        </div>
        <div style={{ ...featureCardStyle, gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>Dashboard</h3>
          <FeatureText>
            See your pro-rata usage quota, the list of current and queued AI tasks, the reviews required from you, and
            more.
          </FeatureText>
          <DashboardMock />
        </div>
      </div>
    </section>
  )
}
