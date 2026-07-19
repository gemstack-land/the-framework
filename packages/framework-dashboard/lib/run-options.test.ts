import { describe, expect, test, vi } from 'vitest'
import type { Preferences } from '@gemstack/framework'

// collectRunOptions reads the autopilot default through the preferences module; stub just that.
vi.mock('./preferences.js', () => ({ autopilotEnabled: (p: Preferences) => p.autopilot ?? true }))

const { collectRunOptions } = await import('./run-options.js')

describe('collectRunOptions (#410)', () => {
  test('sends browser on Claude Code', () => {
    expect(collectRunOptions({ browser: true }).browser).toBe(true)
  })

  test('does not send browser off Claude Code (#801)', () => {
    // The browser is wired through Claude Code's MCP config; another agent's driver takes no MCP
    // servers, so sending it would only earn the CLI's "no effect" notice.
    const options = collectRunOptions({ browser: true, agent: 'codex' })
    expect(options.browser).toBeUndefined()
    expect(options.agent).toBe('codex')
  })
})
