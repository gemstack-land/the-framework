import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PresetsMenu } from './PresetsMenu.js'

afterEach(cleanup)

const presets = [
  { id: 'research', label: '[Research]', render: () => 'RESEARCH PROMPT', tooltip: 'Spike it' },
  { id: 'maintenance', label: '[Maintenance]', render: () => 'MAINTENANCE PROMPT' },
]
const custom = [{ id: 'c1', label: 'My sweep', prompt: 'sweep it' }]

function mount(over: Partial<Parameters<typeof PresetsMenu>[0]> = {}) {
  const onLoad = vi.fn()
  const onNew = vi.fn()
  const onDelete = vi.fn()
  render(
    <PresetsMenu presets={presets} customPresets={custom} busy={false} onLoad={onLoad} onNew={onNew} onDelete={onDelete} {...over} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /presets/i }))
  return { onLoad, onNew, onDelete }
}

// #948: presets used to load only behind typing `/`, and delete lived in the options gear.
describe('PresetsMenu', () => {
  test('lists built-ins and loads the rendered prompt', () => {
    const { onLoad } = mount()
    fireEvent.click(screen.getByText('[Research]'))
    expect(onLoad).toHaveBeenCalledWith('RESEARCH PROMPT', '[Research]')
  })

  test('a saved preset loads verbatim', () => {
    const { onLoad } = mount()
    fireEvent.click(screen.getByText('My sweep'))
    expect(onLoad).toHaveBeenCalledWith('sweep it', 'My sweep')
  })

  test('the delete button deletes without loading', () => {
    const { onLoad, onDelete } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset My sweep' }))
    expect(onDelete).toHaveBeenCalledWith('c1')
    expect(onLoad).not.toHaveBeenCalled()
  })

  test('"New preset…" opens the create panel', () => {
    const { onNew } = mount()
    fireEvent.click(screen.getByText('New preset…'))
    expect(onNew).toHaveBeenCalled()
  })

  test('no create item where no panel exists', () => {
    mount({ onNew: undefined })
    expect(screen.queryByText('New preset…')).toBeNull()
  })
})
