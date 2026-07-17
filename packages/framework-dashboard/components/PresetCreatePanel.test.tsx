import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CustomPreset } from '@gemstack/framework'
import { PresetCreatePanel } from './PresetCreatePanel.js'

afterEach(cleanup)

describe('PresetCreatePanel (#649)', () => {
  test('prefills the prompt from the editor and saves a well-formed preset', () => {
    const onSave = vi.fn()
    render(<PresetCreatePanel currentPrompt="my crafted prompt" busy={false} onSave={onSave} onCancel={() => {}} />)
    expect((screen.getByPlaceholderText(/prompt this preset runs/i) as HTMLTextAreaElement).value).toBe('my crafted prompt')
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'My preset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    const saved = onSave.mock.calls[0]![0] as CustomPreset
    expect({ label: saved.label, prompt: saved.prompt }).toEqual({ label: 'My preset', prompt: 'my crafted prompt' })
    expect(saved.id).toBeTruthy()
  })

  test('cannot save without both a name and a prompt', () => {
    render(<PresetCreatePanel currentPrompt="" busy={false} onSave={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('button', { name: 'Save preset' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Cancel backs out', () => {
    const onCancel = vi.fn()
    render(<PresetCreatePanel currentPrompt="" busy={false} onSave={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
