import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PickerMenu } from './PickerMenu.js'

afterEach(cleanup)

const AGENTS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
]

describe('PickerMenu (#650)', () => {
  test('shows the current option on the trigger', () => {
    render(<PickerMenu value="codex" options={AGENTS} onChange={() => {}} busy={false} title="Coding agent" />)
    expect(screen.getByRole('button', { name: /Codex/ })).toBeTruthy()
  })

  test('choosing an option reports its value', () => {
    const onChange = vi.fn()
    render(<PickerMenu value="claude" options={AGENTS} onChange={onChange} busy={false} title="Coding agent" />)
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ })) // open
    fireEvent.click(screen.getByText('Codex'))
    expect(onChange).toHaveBeenCalledWith('codex')
  })
})
