import { cardStyle, Emoji, h3Style, Note } from './ui'

const ITEMS = [
  'Anti-laziness',
  'No non-consensual decisions without asking',
  'Improved planning',
  'Improved user confirmation',
]

export function EnhancedSystemPrompt() {
  return (
    <section id="enhanced-system-prompt" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h3 style={h3Style}>
        1. Enhanced System Prompt{' '}
        <span aria-hidden style={{ marginLeft: 4, fontSize: 19, verticalAlign: 2 }}>
          <Emoji e="🧭" />
        </span>
      </h3>
      <div
        style={{ ...cardStyle, padding: 'clamp(16px, 4.5vw, 24px)', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#9da9a0', textWrap: 'pretty' }}>
          The Framework appends its own system prompt that instructs AI to follow highly effective practices — such as
          dividing large work into subtasks and listing significant alternative solutions.
        </p>
        <ul
          style={{
            margin: 0,
            listStyle: 'none',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {ITEMS.map((item) => (
            <li key={item} style={{ fontSize: 15, lineHeight: 1.6, display: 'flex', gap: 12 }}>
              <span style={{ color: '#a7c080' }}>✓</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <Note>You can customize it, or fully opt-out.</Note>
    </section>
  )
}
