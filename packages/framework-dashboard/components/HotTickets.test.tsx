import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HotTicket, HotBucket } from '@gemstack/the-framework'

// HotTickets reads onHotTickets over the telefunc shim; stub it so the import graph stays out of
// telefunc and the poll returns fixtures.
const onHotTickets = vi.hoisted(() => vi.fn())
vi.mock('../server/reads.telefunc.js', () => ({ onHotTickets }))

const { HotTickets } = await import('./HotTickets.js')

afterEach(cleanup)

const ht = (file: string, projectName: string, bucket: HotBucket, over: Record<string, unknown> = {}): HotTicket => ({
  projectId: projectName,
  projectName,
  bucket,
  ticket: { file, title: file.replace('.md', ''), summary: '', spiked: false, planned: false, ...over },
})

describe('HotTickets (#1112)', () => {
  test('with no tickets it shows a hint', async () => {
    onHotTickets.mockResolvedValue([])
    render(<HotTickets onSelectProject={() => {}} />)
    await waitFor(() => expect(screen.getByText('No tickets yet.')).toBeTruthy())
  })

  test('groups tickets into the three lanes and selecting one jumps into its project', async () => {
    onHotTickets.mockResolvedValue([
      ht('a.md', 'alpha', 'in-progress', { planned: true }),
      ht('b.md', 'beta', 'next', { priority: 'high' }),
      ht('c.md', 'alpha', 'queued'),
    ])
    let picked: string | null = null
    render(<HotTickets onSelectProject={id => (picked = id)} />)
    await waitFor(() => expect(screen.getByText('a')).toBeTruthy())
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText('Up next')).toBeTruthy()
    expect(screen.getByText('Queued')).toBeTruthy()
    fireEvent.click(screen.getByText('b'))
    expect(picked).toBe('beta')
  })
})
