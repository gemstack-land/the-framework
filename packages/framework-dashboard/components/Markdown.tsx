import { Fragment, type ReactNode } from 'react'

// A tiny, dependency-free Markdown renderer for the surfaced PLAN/TODO docs. Builds
// React nodes (never injects HTML), so agent-written content can't smuggle markup.
// Handles what those docs use: headings, bullet + task lists, fenced/inline code,
// bold/italic. Anything else falls through as a paragraph.
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2 text-sm leading-relaxed">{renderBlocks(text)}</div>
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  let code: string[] | null = null
  let key = 0

  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++} className="ml-4 list-disc space-y-1 marker:text-muted-foreground">
          {list}
        </ul>,
      )
      list = []
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code === null) {
        flushList()
        code = []
      } else {
        blocks.push(
          <pre key={key++} className="overflow-x-auto rounded bg-muted p-2 text-xs">
            <code>{code.join('\n')}</code>
          </pre>,
        )
        code = null
      }
      continue
    }
    if (code !== null) {
      code.push(line)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      const level = heading[1]!.length
      const sizes = ['text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm', 'text-sm']
      blocks.push(
        <p key={key++} className={`font-semibold ${sizes[level - 1]}`}>
          {inline(heading[2]!)}
        </p>,
      )
      continue
    }

    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      list.push(
        <li key={key++} className="list-none -ml-4 flex items-start gap-2">
          <input type="checkbox" checked={task[1]!.toLowerCase() === 'x'} readOnly className="mt-1" />
          <span>{inline(task[2]!)}</span>
        </li>,
      )
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      list.push(<li key={key++}>{inline(bullet[1]!)}</li>)
      continue
    }

    flushList()
    if (line.trim()) blocks.push(<p key={key++}>{inline(line)}</p>)
  }
  flushList()
  if (code !== null) blocks.push(<pre key={key++} className="overflow-x-auto rounded bg-muted p-2 text-xs"><code>{code.join('\n')}</code></pre>)
  return blocks
}

// Inline spans: `code`, **bold**, *italic*. Applied left-to-right, non-overlapping.
function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    const token = m[0]
    if (token.startsWith('`')) parts.push(<code key={key++} className="rounded bg-muted px-1 text-xs">{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    else parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
    last = m.index + token.length
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return parts
}
