import type { ReactElement } from 'react'
import type { RunMeta, ProjectSummary } from '@gemstack/the-framework'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SidebarProvider } from './ui/sidebar.js'

// RunHistory pulls in AddProjectPanel, which imports the projects telefunc shim; stub it so the
// import graph does not drag telefunc into jsdom. Import RunHistory after the mock is in place.
// Resolves to an empty list: the rail now renders ProjectPicker, which fetches on mount.
const onProjects = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const sendAddProject = vi.hoisted(() => vi.fn())
vi.mock('../server/projects.telefunc.js', () => ({ onProjects, sendAddProject }))

// The rail now also carries the app chrome moved off the top navbar (#772 follow-up). Three of
// those pull the preferences/devices telefunc shims into jsdom, which this suite deliberately
// avoids. It is about the runs list, not the chrome (each has its own suite), so stub them out.
vi.mock('./ThemeToggle.js', () => ({ ThemeToggle: () => null }))
vi.mock('./NotificationsMenu.js', () => ({ NotificationsMenu: () => null }))
vi.mock('./ConnectionIndicator.js', () => ({ ConnectionIndicator: () => null }))

const { RunHistory } = await import('./RunHistory.js')

afterEach(cleanup)

function run(over: Partial<RunMeta> = {}): RunMeta {
  return {
    version: 1,
    status: 'running',
    id: 'run-1',
    startedAt: '2026-07-19T16:05:44.756Z',
    updatedAt: '2026-07-19T16:06:21.000Z',
    passes: 1,
    intent: "replace 'Hello, world!' with 'Welcome!'",
    ...over,
  }
}

// RunHistory renders the shadcn <Sidebar>, which reads SidebarProvider context; wrap every render.
const renderRail = (ui: ReactElement) => render(<SidebarProvider>{ui}</SidebarProvider>)

describe('RunHistory (#785)', () => {
  test('a working run reads as running and animates', () => {
    const { container } = renderRail(<RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.getByText('running')).toBeTruthy()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  test('a run parked on the user reads as waiting and stops animating', () => {
    // The build settled and it is waiting for a message: same live process, different meaning.
    const { container } = renderRail(
      <RunHistory projectId="p1" runs={[run({ settledAt: '2026-07-19T16:06:21.000Z' })]} selectedRunId={null} onSelect={() => {}} />,
    )
    expect(screen.getByText('waiting')).toBeTruthy()
    expect(screen.queryByText('running')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  test('a session selected before its row lands highlights the starting row (#784)', () => {
    // Start navigates to the run's id right away; its run.json, and so its row, arrives a beat
    // later. The highlight belongs on the optimistic row standing in for it, not on the home row.
    const { container, rerender } = renderRail(
      <RunHistory projectId="p1" runs={[]} selectedRunId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <RunHistory projectId="p1" runs={[]} selectedRunId="run-2" onSelect={() => {}} startTick={1} startIntent="add dark mode" />
      </SidebarProvider>,
    )
    const rows = [...container.querySelectorAll('button')]
    const home = rows.find(row => row.textContent?.trim() === 'New')
    const starting = rows.find(row => row.textContent?.includes('starting…'))
    expect(starting?.className).toContain('bg-accent')
    expect(home?.className).not.toContain('bg-accent')
  })

  test('a finished run is finished, never waiting', () => {
    // settledAt is cleared on `end`, but a stale one must not relabel a terminal status.
    renderRail(
      <RunHistory
        projectId="p1"
        runs={[run({ status: 'done', settledAt: '2026-07-19T16:06:21.000Z' })]}
        selectedRunId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('done')).toBeTruthy()
    expect(screen.queryByText('waiting')).toBeNull()
  })
})

// The rail is the shadcn Sidebar now (shared shell), a fixed-width in-flow column rather than the
// bespoke collapsing <aside> of #862 — the shadcn Sidebar owns collapse, and the shell never drove
// the old prop, so those strip/float tests are retired with it.
describe('RunHistory rows', () => {
  test('a run on a connected device shows a device glyph naming the device (#1067)', () => {
    renderRail(<RunHistory projectId="p1" runs={[run({ target: 'remote', remoteLabel: 'my-laptop' })]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Runs on my-laptop')).toBeTruthy()
  })

  test('a local run has no device glyph (#1067)', () => {
    renderRail(<RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText(/Runs on/)).toBeNull()
  })

  // The shared shell: the rail is present on the home/Overview too (no project selected), showing
  // the New launcher rather than vanishing.
  test('with no project and no recents it still renders New and an empty hint', () => {
    renderRail(<RunHistory projectId={null} runs={[]} recentRuns={[]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.getByText('New')).toBeTruthy()
    expect(screen.getByText('No sessions yet.')).toBeTruthy()
  })

  // On the Overview the rail pools every project's sessions; a row names its project and jumps in.
  test('on the Overview it lists cross-project recents and selecting one jumps into its project', () => {
    let picked: [string, string] | null = null
    const recentRuns = [
      { projectId: 'proj-a', projectName: 'alpha', run: run({ id: 'r-a', intent: 'fix login' }) },
      { projectId: 'proj-b', projectName: 'beta', run: run({ id: 'r-b', status: 'done', intent: 'add tests' }) },
    ]
    renderRail(
      <RunHistory
        projectId={null}
        runs={[]}
        recentRuns={recentRuns}
        onSelectRecent={(pid, rid) => (picked = [pid, rid])}
        selectedRunId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('fix login')).toBeTruthy()
    expect(screen.getByText(/alpha/)).toBeTruthy()
    fireEvent.click(screen.getByText('add tests'))
    expect(picked).toEqual(['proj-b', 'r-b'])
  })
})

const proj = (id: string, name: string): ProjectSummary => ({ id, path: `/${id}`, name, activated: true })

describe('RunHistory New button (#new-button)', () => {
  test('with one project, New starts a session in it', () => {
    let started: string | null = null
    renderRail(
      <RunHistory
        projectId={null}
        runs={[]}
        recentRuns={[]}
        projects={[proj('p1', 'alpha')]}
        onNewSessionInProject={id => (started = id)}
        selectedRunId={null}
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('New'))
    expect(started).toBe('p1')
  })

  test('inside a project, New starts another session in that project', () => {
    let started: string | null = null
    renderRail(
      <RunHistory
        projectId="p9"
        runs={[]}
        projects={[proj('p1', 'alpha'), proj('p9', 'nine')]}
        onNewSessionInProject={id => (started = id)}
        selectedRunId={null}
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('New'))
    expect(started).toBe('p9')
  })

  test('with several projects and none selected, New is a picker menu', () => {
    renderRail(
      <RunHistory
        projectId={null}
        runs={[]}
        recentRuns={[]}
        projects={[proj('p1', 'alpha'), proj('p2', 'beta')]}
        onNewSessionInProject={() => {}}
        selectedRunId={null}
        onSelect={() => {}}
      />,
    )
    // The trigger opens a menu rather than starting immediately (aria-haspopup marks it).
    expect(screen.getByLabelText('New session').getAttribute('aria-haspopup')).toBeTruthy()
  })
})
