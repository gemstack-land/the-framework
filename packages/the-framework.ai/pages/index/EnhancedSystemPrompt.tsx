import { h3Style, Note } from './ui'

const ITEMS = [
  'Avoiding AI from being lazy',
  'Avoiding AI making implicit non-consensual decisions',
  'Enhanced planning',
  'Enhanced user confirmation — if variability, at-a-glance TL;DR choices',
]

export function EnhancedSystemPrompt() {
  return (
    <section
      id="enhanced-system-prompt"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
        gap: 'clamp(28px, 5vw, 48px)',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={h3Style}>Enhanced System Prompt</h3>
        <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.65, color: '#9da9a0', textWrap: 'pretty' }}>
          The Framework appends its own system prompt that instructs AI to follow highly effective practices — such as
          dividing large work into subtasks and listing significant alternative solutions.
        </p>
        <Note>You can customize it, or fully opt-out.</Note>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ITEMS.map((item) => (
          <li
            key={item}
            style={{
              background: '#343f44',
              border: '1px solid #3d484d',
              borderRadius: 10,
              padding: '16px 20px',
              fontSize: 15,
              lineHeight: 1.5,
              display: 'flex',
              gap: 12,
            }}
          >
            <span style={{ color: '#a7c080' }}>✓</span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
