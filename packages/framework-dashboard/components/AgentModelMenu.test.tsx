import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentModelMenu, type AgentOption } from './AgentModelMenu.js'

afterEach(cleanup)

const agents: AgentOption[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    icon: <svg data-testid="claude-logo" />,
    models: [
      { value: '', label: 'Default model' },
      { value: 'opus', label: 'Opus' },
    ],
  },
  {
    value: 'codex',
    label: 'Codex',
    models: [
      { value: '', label: 'Default model' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    ],
  },
]

function renderMenu(over: Partial<Parameters<typeof AgentModelMenu>[0]> = {}) {
  const onChange = vi.fn()
  render(<AgentModelMenu agents={agents} agent="claude" model="opus" onChange={onChange} busy={false} {...over} />)
  return { onChange }
}

describe('AgentModelMenu tree (#658)', () => {
  test('the trigger shows the current agent logo and model', () => {
    renderMenu()
    const trigger = screen.getByRole('button')
    expect(trigger.querySelector('[data-testid="claude-logo"]')).toBeTruthy()
    expect(trigger.textContent).toContain('Opus')
    expect(trigger.getAttribute('title')).toContain('Claude Code')
  })

  test('picking a model within an agent sets both the agent and the model', () => {
    const { onChange } = renderMenu()
    fireEvent.click(screen.getByRole('button')) // open root
    fireEvent.click(screen.getByText('Codex')) // open the Codex submenu
    fireEvent.click(screen.getByText('GPT-5 Codex'))
    expect(onChange).toHaveBeenCalledWith('codex', 'gpt-5-codex')
  })

  test("each agent's submenu shows only its own models", () => {
    renderMenu({ model: '' }) // keep 'Opus' out of the trigger so we count only submenu items
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Claude Code')) // Claude submenu
    expect(screen.getByText('Opus')).toBeTruthy() // Claude's own model
    expect(screen.queryByText('GPT-5 Codex')).toBeNull() // a Claude submenu never lists Codex models
  })
})
