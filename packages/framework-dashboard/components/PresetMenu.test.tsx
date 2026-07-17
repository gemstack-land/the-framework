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

const noop = () => {}
function base() {
  return { builtIns, customPresets: [] as CustomPreset[], busy: false, onLoadBuiltIn: noop, onUseCustom: noop, onDeleteCustom: noop, onNewPreset: noop }
}
/** Open the Presets dropdown so its portalled items render. */
function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Presets/ }))
}

describe('PresetMenu (#649)', () => {
  test('loads a built-in preset when its item is chosen', () => {
    const onLoadBuiltIn = vi.fn()
    render(<PresetMenu {...base()} onLoadBuiltIn={onLoadBuiltIn} />)
    openMenu()
    fireEvent.click(screen.getByText('Research'))
    expect(onLoadBuiltIn).toHaveBeenCalledWith(builtIns[0])
  })

  test('loads a saved preset when its item is chosen', () => {
    const onUseCustom = vi.fn()
    const saved = preset('a', 'Deep review', 'Audit this.')
    render(<PresetMenu {...base()} customPresets={[saved]} onUseCustom={onUseCustom} />)
    openMenu()
    fireEvent.click(screen.getByText('Deep review'))
    expect(onUseCustom).toHaveBeenCalledWith(saved)
  })

  test('deletes a saved preset by id', () => {
    const onDeleteCustom = vi.fn()
    render(<PresetMenu {...base()} customPresets={[preset('a', 'One', 'x')]} onDeleteCustom={onDeleteCustom} />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset One' }))
    expect(onDeleteCustom).toHaveBeenCalledWith('a')
  })

  test('New preset asks the parent to open the create panel', () => {
    const onNewPreset = vi.fn()
    render(<PresetMenu {...base()} onNewPreset={onNewPreset} />)
    openMenu()
    fireEvent.click(screen.getByText('New preset…'))
    expect(onNewPreset).toHaveBeenCalledTimes(1)
  })
})
