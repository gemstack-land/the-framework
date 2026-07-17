import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CustomPreset } from '@gemstack/framework'
import { CustomPresets } from './CustomPresets.js'

afterEach(cleanup)

const preset = (id: string, label: string, prompt: string): CustomPreset => ({ id, label, prompt })

describe('CustomPresets (#626)', () => {
  test('loads a saved preset into the editor when its button is clicked', () => {
    const onUse = vi.fn()
    render(<CustomPresets presets={[preset('a', 'Deep review', 'Audit this.')]} currentPrompt="" busy={false} onUse={onUse} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deep review' }))
    expect(onUse).toHaveBeenCalledWith(preset('a', 'Deep review', 'Audit this.'))
  })

  test('saves a new preset, prefilling the prompt from the current editor text', () => {
    const onChange = vi.fn()
    render(<CustomPresets presets={[]} currentPrompt="my crafted prompt" busy={false} onUse={() => {}} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Preset/ })) // opens the add panel
    // The prompt textarea is prefilled with the current editor content.
    expect((screen.getByPlaceholderText(/prompt this preset runs/i) as HTMLTextAreaElement).value).toBe('my crafted prompt')
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'My preset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const saved = onChange.mock.calls[0]![0] as CustomPreset[]
    expect(saved).toHaveLength(1)
    expect({ label: saved[0]!.label, prompt: saved[0]!.prompt }).toEqual({ label: 'My preset', prompt: 'my crafted prompt' })
    expect(saved[0]!.id).toBeTruthy()
  })

  test('will not save without both a name and a prompt', () => {
    const onChange = vi.fn()
    render(<CustomPresets presets={[]} currentPrompt="" busy={false} onUse={() => {}} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Preset/ }))
    expect((screen.getByRole('button', { name: 'Save preset' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('deletes a preset by id', () => {
    const onChange = vi.fn()
    render(
      <CustomPresets
        presets={[preset('a', 'One', 'x'), preset('b', 'Two', 'y')]}
        currentPrompt=""
        busy={false}
        onUse={() => {}}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset One' }))
    expect(onChange).toHaveBeenCalledWith([preset('b', 'Two', 'y')])
  })
})
