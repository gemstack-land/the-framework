import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const onProjects = vi.hoisted(() => vi.fn())
const sendAddProject = vi.hoisted(() => vi.fn())
vi.mock('../server/projects.telefunc.js', () => ({ onProjects, sendAddProject }))

const { ProjectPicker } = await import('./ProjectPicker.js')

const PROJECTS = [
  { id: 'alpha', name: 'alpha', activated: true, lastActivityAt: null },
  { id: 'beta', name: 'beta', activated: false, lastActivityAt: null },
]

afterEach(() => {
  cleanup()
  onProjects.mockReset()
  sendAddProject.mockReset()
})

function open() {
  fireEvent.click(screen.getByRole('button', { name: /^project:/i }))
}

describe('ProjectPicker (#772)', () => {
  test('the trigger names the selected project', async () => {
    onProjects.mockResolvedValue(PROJECTS)
    render(<ProjectPicker selectedId="beta" onSelect={() => {}} onDashboard={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^project:/i }).textContent).toContain('beta'))
  })

  test('no selection reads as all projects, not as a blank', () => {
    onProjects.mockResolvedValue(PROJECTS)
    render(<ProjectPicker selectedId={null} onSelect={() => {}} onDashboard={() => {}} />)
    expect(screen.getByRole('button', { name: /^project:/i }).textContent).toContain('All projects')
  })

  test('picking a project reports it', async () => {
    onProjects.mockResolvedValue(PROJECTS)
    const onSelect = vi.fn()
    render(<ProjectPicker selectedId={null} onSelect={onSelect} onDashboard={() => {}} />)
    open()
    fireEvent.click(await screen.findByText('alpha'))
    expect(onSelect).toHaveBeenCalledWith('alpha')
  })

  test('the Overview entry goes to the Overview', async () => {
    onProjects.mockResolvedValue(PROJECTS)
    const onDashboard = vi.fn()
    render(<ProjectPicker selectedId="alpha" onSelect={() => {}} onDashboard={onDashboard} />)
    open()
    fireEvent.click(await screen.findByText('Overview'))
    expect(onDashboard).toHaveBeenCalled()
  })

  // The rail carried the "needs you" count (#632); removing it must not remove the signal.
  test('the needs-you count shows on the trigger while a project is selected', async () => {
    onProjects.mockResolvedValue(PROJECTS)
    render(<ProjectPicker selectedId="alpha" onSelect={() => {}} onDashboard={() => {}} interventionCount={3} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^project:/i }).textContent).toContain('3'))
  })

  test('an id that names no registered project is shown as-is, not rewritten', async () => {
    onProjects.mockResolvedValue(PROJECTS)
    const onSelect = vi.fn()
    const onDashboard = vi.fn()
    render(<ProjectPicker selectedId="gone" onSelect={onSelect} onDashboard={onDashboard} />)
    await waitFor(() => expect(onProjects).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^project:/i }).textContent).toContain('gone')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onDashboard).not.toHaveBeenCalled()
  })

  test('Add project opens the panel, which still asks about trust before adding (#439)', async () => {
    onProjects.mockResolvedValue(PROJECTS)
    sendAddProject.mockResolvedValue({ ok: true })
    render(<ProjectPicker selectedId={null} onSelect={() => {}} onDashboard={() => {}} />)
    open()
    fireEvent.click(await screen.findByText('Add project'))
    const dialog = await screen.findByRole('dialog', { name: /add project/i })
    expect(dialog).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/repository path/i), { target: { value: '/repo' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    // The trust gate stands between the path and the install.
    expect(await screen.findByText(/do you trust this repository/i)).toBeTruthy()
    expect(sendAddProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /trust it/i }))
    await waitFor(() => expect(sendAddProject).toHaveBeenCalledWith('/repo', false))
  })
})
