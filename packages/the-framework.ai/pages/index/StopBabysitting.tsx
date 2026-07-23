import { cardStyle, mono, SectionHead, sectionStyle } from './ui'

const ROW_STYLES = {
  bad: { bg: '#2d353b', border: '#3d484d', labelColor: '#859289' },
  good: { bg: '#232a2e', border: '#475258', labelColor: '#a7c080' },
} as const

type Row = { kind: keyof typeof ROW_STYLES; emoji: string; label: string; body: string }
const bad = (body: string): Row => ({ kind: 'bad', emoji: '😕', label: 'Bad fix', body })
const good = (body: string): Row => ({ kind: 'good', emoji: '🚀', label: 'Solution', body })

const PROBLEMS: { title: string; desc?: string; rows: Row[] }[] = [
  {
    title: 'AI is lazy',
    rows: [
      bad('Appending "DON\'T BE LAZY" to your prompts → minimal improvement.'),
      good(
        'Divide-and-conquer: The Framework instructs AI to split large tasks into smaller subtasks. By focusing on one unit of work at a time, AI spends significantly more effort overall, resulting in much higher-quality output.',
      ),
      good(
        'Coverage guarantees: The Framework lets AI enumerate everything that needs to be done before writing code. AI then works through that checklist, ensuring comprehensive coverage and preventing lazy shortcuts.',
      ),
    ],
  },
  {
    title: 'Lazy planning',
    rows: [
      bad('Tell AI to deep dive for each important aspect.'),
      good('Powerful loop of critical feedback and research.'),
    ],
  },
  {
    title: 'Lazy low-quality code',
    desc: 'Despite AI being able to write high-quality code, it often goes for the quickest/laziest solution (not correct, not maintainable, not DRY).',
    rows: [
      bad('Appending "WRITE the HIGHEST quality code you ever wrote" to your prompts → minimal improvement.'),
      good("The Framework makes AI question and review itself until it's highly confident about its implementation."),
    ],
  },
  {
    title: 'AI makes important decisions without asking',
    rows: [
      bad('Tell AI "don\'t do this, research alternatives".'),
      good(
        'The Framework makes AI gauge the variability of its implementation: if there are alternatives with subtle pros and cons, show them to the user.',
      ),
    ],
  },
  {
    title: 'AI forgets',
    rows: [
      bad('You keep repeating yourself (previous decisions, business context, …).'),
      good(
        "The Framework's Enhanced System Prompt tells AI to retain knowledge in files such as knowledge-base/DECISIONS.md and knowledge-base/INSIGHTS.md. (See section 03 below.)",
      ),
    ],
  },
]

export function StopBabysitting() {
  return (
    <section id="stop-babysitting" style={sectionStyle}>
      <SectionHead
        title="Stop babysitting"
        sub="Stop losing time micro-managing agents — focus on what matters instead."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {PROBLEMS.map((p) => (
          <div
            key={p.title}
            className="problem-card"
            style={{
              ...cardStyle,
              padding: 'clamp(18px, 4vw, 28px)',
              display: 'grid',
              gridTemplateColumns: '280px 1fr',
              gap: 32,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11.5,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#e67e80',
                }}
              >
                Problem
              </span>
              <h3 style={{ margin: 0, fontSize: 21, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</h3>
              {p.desc && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#9da9a0' }}>{p.desc}</p>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {p.rows.map((r, i) => {
                const s = ROW_STYLES[r.kind]
                return (
                  <div
                    key={i}
                    className="solution-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '118px 1fr',
                      gap: 14,
                      alignItems: 'baseline',
                      padding: '12px 16px',
                      borderRadius: 9,
                      background: s.bg,
                      border: `1px solid ${s.border}`,
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 12, color: s.labelColor, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 16, verticalAlign: -2, marginRight: 4 }}>{r.emoji}</span>
                      {r.label}
                    </span>
                    <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#d3c6aa' }}>{r.body}</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
