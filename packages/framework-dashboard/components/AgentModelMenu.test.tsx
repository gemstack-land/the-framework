import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentModelMenu } from './AgentModelMenu.js'

afterEach(cleanup)

const agentOptions = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
]
const modelOptions = [
  { value: '', label: 'Default model' },
  { value: 'opus', label: 'Opus' },
]

function renderMenu(over: Partial<Parameters<typeof AgentModelMenu>[0]> = {}) {
  const onAgentChange = vi.fn()
  const onModelChange = vi.fn()
  render(
    <AgentModelMenu
      agent="claude"
      agentOptions={agentOptions}
      onAgentChange={onAgentChange}
      model=""
      modelOptions={modelOptions}
      onModelChange={onModelChange}
      busy={false}
      {...over}
    />,
  )
  return { onAgentChange, onModelChange }
}

describe('AgentModelMenu (#650)', () => {
  test('the trigger shows the current agent and model', () => {
    renderMenu({ agent: 'codex', model: 'opus' })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toContain('Codex')
    expect(trigger.textContent).toContain('Opus')
  })

  test('choosing a model from its submenu reports the value', () => {
    const { onModelChange } = renderMenu()
    fireEvent.click(screen.getByRole('button')) // open root
    fireEvent.click(screen.getByText('Model')) // open the Model submenu
    fireEvent.click(screen.getByText('Opus'))
    expect(onModelChange).toHaveBeenCalledWith('opus')
  })

  test('choosing an agent from its submenu reports the value', () => {
    const { onAgentChange } = renderMenu()
    fireEvent.click(screen.getByRole('button')) // open root
    fireEvent.click(screen.getByText('Agent')) // open the Agent submenu
    fireEvent.click(screen.getByText('Codex'))
    expect(onAgentChange).toHaveBeenCalledWith('codex')
  })
})
