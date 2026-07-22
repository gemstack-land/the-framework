import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgentView } from '../lib/live-state.js'

// The rail's panels are Telefunc-backed; this is about the rail's own width, so stub them.
vi.mock('./DocsPanel.js', () => ({ DocsPanel: () => <div>docs</div> }))
vi.mock('./ProjectLogPanel.js', () => ({ ProjectLogPanel: () => <div>log</div> }))
vi.mock('./FileTree.js', () => ({ FileTree: () => <div>files</div> }))
vi.mock('./BrowserPanel.js', () => ({ BrowserPanel: () => <div>browser</div> }))
vi.mock('./ChoicesRail.js', () => ({ ChoicesRail: () => <div>choices</div> }))
vi.mock('./TicketsPanel.js', () => ({ TicketsPanel: () => <div>tickets</div> }))

const { RightRail } = await import('./RightRail.js')

afterEach(cleanup)

const view: AgentView = { id: 'v1', title: 'Plan', markdown: '# hello' } as AgentView

const baseProps = {
  projectId: 'p1',
  runId: 'r1',
  choices: [],
  views: [],
  files: [],
  context: new Set<string>(),
  toggleContext: () => {},
}

// The rail holds one fixed width for every tab: switching to a pushed view no longer widens it
// (the per-tab wide mode from #862 was dropped so the tabs read as one stable column).
describe('RightRail width', () => {
  const rail = (container: HTMLElement) => container.querySelector('aside')!

  test('a list-shaped tab holds the fixed width', () => {
    const { container } = render(<RightRail {...baseProps} />)
    expect(rail(container).className).toContain('w-[27rem]')
  })

  test('a pushed view keeps the same width — no expand', () => {
    const { container } = render(<RightRail {...baseProps} views={[view]} />)
    // The first view pulls the rail to the Views tab on its own, but the width does not change.
    expect(rail(container).className).toContain('w-[27rem]')
  })

  test('the width is unchanged after switching away from a view', () => {
    const { container } = render(<RightRail {...baseProps} views={[view]} />)
    fireEvent.click(screen.getByRole('tab', { name: /docs/i }))
    expect(rail(container).className).toContain('w-[27rem]')
  })

  test('no project means no rail', () => {
    const { container } = render(<RightRail {...baseProps} projectId={null} />)
    expect(container.querySelector('aside')).toBeNull()
  })
})
