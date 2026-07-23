import type { ReactNode } from 'react'
import { cardStyle, CodeChip, SectionHead, sectionStyle, WipBadge } from './ui'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: 'clamp(18px, 4.5vw, 26px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h3>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontSize: 14.5,
          lineHeight: 1.55,
          color: '#9da9a0',
        }}
      >
        {children}
      </ul>
    </div>
  )
}

function Item({ children }: { children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: '#a7c080' }}>✓</span>
      {children}
    </li>
  )
}

export function YourFramework() {
  return (
    <section id="your-framework" style={sectionStyle}>
      <SectionHead
        title={
          <>
            <em style={{ fontStyle: 'italic', color: '#a7c080' }}>Your</em> framework
          </>
        }
        sub="It isn't our framework — it's yours."
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <Card title="Flexible">
          <Item>The Framework doesn't force anything: pick only the features you need</Item>
          <li data-wip="1" style={{ display: 'flex', gap: 10 }}>
            <WipBadge style={{ alignSelf: 'flex-start', marginTop: 2 }} />
            Customize anything to fit your needs
          </li>
        </Card>
        <Card title="100% Local">
          <Item>Runs locally on your machine, like a desktop app</Item>
          <Item>No backdoors, no tracking</Item>
          <Item>
            <span>
              Knowledge saved as <CodeChip fontSize={12.5}>knowledge-base/*.md</CodeChip> in your Git repository
            </span>
          </Item>
          <Item>You fully own your data</Item>
        </Card>
        <Card title="100% Open Source">
          <Item>Transparent — no hidden code</Item>
          <Item>
            Something's not working for you? Ask your favorite AI to make a Pull Request — we welcome agentic
            contributions!
          </Item>
        </Card>
      </div>
    </section>
  )
}
