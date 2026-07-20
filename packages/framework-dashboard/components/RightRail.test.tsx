import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgentView } from '../lib/live-state.js'

// The rail's panels are Telefunc-backed; this is about the rail's own width, so stub them.
vi.mock('./DocsPanel.js', () => ({ DocsPanel: () => <div>docs</div> }))
vi.mock('./ProjectLogPanel.js', () => ({ ProjectLogPanel: () => <div>log</div> }))
vi.mock('./FileTree.js', () => ({ FileTree: () => <div>files</div> }))
vi.mock('./BrowserPanel.js', () => ({ BrowserPanel: () => <div>browser</div> }))
vi.mock('./ChoicesRail.js', () => ({ ChoicesRail: () => <div>choices</div> }))

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

// #862: the rail asks for the room when it is showing something worth reading wide, and the
// shell hands it over by collapsing the sessions rail. Reported up, since only the rail knows
// which tab is open.
describe('RightRail wide mode (#862)', () => {
  const rail = (container: HTMLElement) => container.querySelector('aside')!

  test('a list-shaped tab stays narrow and asks for nothing', () => {
    const onWideChange = vi.fn()
    const { container } = render(<RightRail {...baseProps} onWideChange={onWideChange} />)
    expect(rail(container).className).toContain('w-80')
    expect(onWideChange).toHaveBeenLastCalledWith(false)
  })

  test('a pushed view takes the wide form and says so', () => {
    const onWideChange = vi.fn()
    const { container } = render(<RightRail {...baseProps} views={[view]} onWideChange={onWideChange} />)
    // The first view pulls the rail to the Views tab on its own.
    expect(rail(container).className).toContain('w-[32rem]')
    expect(onWideChange).toHaveBeenLastCalledWith(true)
  })

  test('leaving the view gives the room back', () => {
    const onWideChange = vi.fn()
    const { container } = render(<RightRail {...baseProps} views={[view]} onWideChange={onWideChange} />)
    fireEvent.click(screen.getByRole('button', { name: /docs/i }))
    expect(rail(container).className).toContain('w-80')
    expect(onWideChange).toHaveBeenLastCalledWith(false)
  })

  test('no project means no rail and no claim on the room', () => {
    const onWideChange = vi.fn()
    const { container } = render(<RightRail {...baseProps} projectId={null} onWideChange={onWideChange} />)
    expect(container.querySelector('aside')).toBeNull()
    expect(onWideChange).toHaveBeenLastCalledWith(false)
  })
})
