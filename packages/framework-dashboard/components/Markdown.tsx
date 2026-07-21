import { Fragment, type ReactNode } from 'react'

// A tiny, dependency-free Markdown renderer for the surfaced PLAN/TODO docs and the agent's
// pushed views (#441). Builds React nodes (never injects HTML), so agent-written content
// can't smuggle markup. Handles what that content uses: headings, bullet + task lists,
// fenced/inline code, bold/italic, links (#948 — plans and summaries carry PR/issue URLs
// the reader wants to click; http(s) only, so no javascript: smuggling), and pipe tables
// (#869 — an agent comparing options or listing files reaches for one, and it rendered as
// raw pipes). Anything else falls through as a paragraph.
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2 text-sm leading-relaxed">{renderBlocks(text)}</div>
}

// A fenced-code block, rendered both when its closing fence arrives and when the doc ends
// mid-fence; one place so the markup and classes can't drift between the two.
function codeBlock(lines: string[], key: number): ReactNode {
  return (
    <pre key={key} className="overflow-x-auto rounded bg-muted p-2 text-xs">
      <code>{lines.join('\n')}</code>
    </pre>
  )
}

/** A pipe-table row's cells, outer empties dropped (`| a | b |` -> ['a', 'b']). */
function tableCells(row: string): string[] {
  const cells = row.trim().split('|')
  if (cells[0]?.trim() === '') cells.shift()
  if (cells[cells.length - 1]?.trim() === '') cells.pop()
  return cells.map(c => c.trim())
}

/** The GFM header separator (`| --- | :-: |`), which is what makes pipe rows a table. */
function isTableSeparator(row: string): boolean {
  return tableCells(row).length > 0 && tableCells(row).every(c => /^:?-{3,}:?$/.test(c))
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  let code: string[] | null = null
  let table: string[] = []
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

  const flushTable = () => {
    if (table.length === 0) return
    const rows = table
    table = []
    // A real table needs the separator as its second row; anything else was just prose
    // with pipes, rendered as the paragraphs it would have been.
    if (rows.length >= 2 && isTableSeparator(rows[1]!)) {
      const header = tableCells(rows[0]!)
      const body = rows.slice(2).map(tableCells)
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i} className="border-b border-border px-2 py-1 text-left font-semibold">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((cells, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td key={c} className="border-b border-border/50 px-2 py-1 align-top">
                      {inline(cells[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    } else {
      for (const row of rows) blocks.push(<p key={key++}>{inline(row)}</p>)
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code === null) {
        flushList()
        code = []
      } else {
        blocks.push(codeBlock(code, key++))
        code = null
      }
      continue
    }
    if (code !== null) {
      code.push(line)
      continue
    }

    // Consecutive `| … |` rows buffer into a table candidate; anything else flushes it.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList()
      table.push(line)
      continue
    }
    flushTable()

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
  flushTable()
  if (code !== null) blocks.push(codeBlock(code, key++))
  return blocks
}

// Inline spans: `code`, [text](url), **bold**, *italic*, bare URLs. Applied left-to-right,
// non-overlapping; code wins over the rest so a URL inside backticks stays literal. Links
// render only for http(s) targets — anything else stays plain text.
const LINK_CLASS = 'text-primary underline underline-offset-2 break-all'

function link(href: string, label: string, key: number): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {label}
    </a>
  )
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<>)\]]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    const token = m[0]
    if (token.startsWith('`')) parts.push(<code key={key++} className="rounded bg-muted px-1 text-xs">{token.slice(1, -1)}</code>)
    else if (token.startsWith('[')) {
      const parsed = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      if (parsed) parts.push(link(parsed[2]!, parsed[1]!, key++))
      else parts.push(<Fragment key={key++}>{token}</Fragment>)
    } else if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*')) parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
    else parts.push(link(token, token, key++))
    last = m.index + token.length
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return parts
}
