import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContextFiles } from './ContextFiles.js'

afterEach(cleanup)

describe('ContextFiles (#661)', () => {
  test('renders nothing when there are no files', () => {
    const { container } = render(<ContextFiles files={[]} onRemove={() => {}} busy={false} />)
    expect(container.firstChild).toBeNull()
  })

  test('shows each file by its basename, with the full path as the title', () => {
    render(<ContextFiles files={['DECISIONS.md', 'css/theme.ts']} onRemove={() => {}} busy={false} />)
    expect(screen.getByText('DECISIONS.md')).toBeTruthy()
    const nested = screen.getByText('theme.ts')
    expect(nested.getAttribute('title') ?? nested.closest('[title]')?.getAttribute('title')).toBe('css/theme.ts')
  })

  test('removing a chip reports the full path', () => {
    const onRemove = vi.fn()
    render(<ContextFiles files={['DECISIONS.md']} onRemove={onRemove} busy={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove DECISIONS\.md/ }))
    expect(onRemove).toHaveBeenCalledWith('DECISIONS.md')
  })
})
