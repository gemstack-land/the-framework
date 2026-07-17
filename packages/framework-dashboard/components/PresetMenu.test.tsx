import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CustomPreset } from '@gemstack/framework'
import { PresetMenu, type BuiltInPreset } from './PresetMenu.js'

afterEach(cleanup)

const preset = (id: string, label: string, prompt: string): CustomPreset => ({ id, label, prompt })
const builtIns: BuiltInPreset[] = [
  { id: 'research', label: 'Research', render: () => 'Research this.' },
  { id: 'ux', label: 'UX', render: () => 'Improve the UX.' },
]

/** Open the Presets dropdown so its portalled items render. */
function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Presets/ }))
}

describe('PresetMenu (#649)', () => {
  test('loads a built-in preset when its menu item is chosen', () => {
    const onLoadBuiltIn = vi.fn()
    render(
      <PresetMenu builtIns={builtIns} customPresets={[]} currentPrompt="" busy={false} onLoadBuiltIn={onLoadBuiltIn} onUseCustom={() => {}} onChangeCustom={() => {}} />,
    )
    openMenu()
    fireEvent.click(screen.getByText('Research'))
    expect(onLoadBuiltIn).toHaveBeenCalledWith(builtIns[0])
  })

  test('loads a saved preset when its menu item is chosen', () => {
    const onUseCustom = vi.fn()
    const saved = preset('a', 'Deep review', 'Audit this.')
    render(
      <PresetMenu builtIns={builtIns} customPresets={[saved]} currentPrompt="" busy={false} onLoadBuiltIn={() => {}} onUseCustom={onUseCustom} onChangeCustom={() => {}} />,
    )
    openMenu()
    fireEvent.click(screen.getByText('Deep review'))
    expect(onUseCustom).toHaveBeenCalledWith(saved)
  })

  test('deletes a saved preset by id', () => {
    const onChangeCustom = vi.fn()
    render(
      <PresetMenu builtIns={builtIns} customPresets={[preset('a', 'One', 'x'), preset('b', 'Two', 'y')]} currentPrompt="" busy={false} onLoadBuiltIn={() => {}} onUseCustom={() => {}} onChangeCustom={onChangeCustom} />,
    )
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset One' }))
    expect(onChangeCustom).toHaveBeenCalledWith([preset('b', 'Two', 'y')])
  })

  test('New preset opens the inline panel, prefilled from the current editor text, and saves', () => {
    const onChangeCustom = vi.fn()
    render(
      <PresetMenu builtIns={builtIns} customPresets={[]} currentPrompt="my crafted prompt" busy={false} onLoadBuiltIn={() => {}} onUseCustom={() => {}} onChangeCustom={onChangeCustom} />,
    )
    openMenu()
    fireEvent.click(screen.getByText('New preset…'))
    expect((screen.getByPlaceholderText(/prompt this preset runs/i) as HTMLTextAreaElement).value).toBe('my crafted prompt')
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'My preset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    const savedList = onChangeCustom.mock.calls[0]![0] as CustomPreset[]
    expect({ label: savedList[0]!.label, prompt: savedList[0]!.prompt }).toEqual({ label: 'My preset', prompt: 'my crafted prompt' })
    expect(savedList[0]!.id).toBeTruthy()
  })
})
