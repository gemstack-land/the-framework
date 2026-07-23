import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { OptionRow, ConnectionControl, RunTarget } from './OptionsMenu.js'
import type { ConnectionProfile } from '../lib/profiles.js'

const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', () => ({ updatePreferences }))

const { OptionsMenu } = await import('./OptionsMenu.js')

afterEach(() => {
  cleanup()
  updatePreferences.mockReset()
})

const mainOptions = (): OptionRow[] => [
  { key: 'autopilot', label: 'Autopilot', title: 't', checked: false },
  { key: 'eco', label: 'Eco', title: 't', checked: true },
]
const ecoOptions = (): OptionRow[] => [{ key: 'ecoPlanning', label: 'Auto planning', title: 't', checked: false }]

function open() {
  fireEvent.click(screen.getByRole('button', { name: /session options/i }))
}

describe('OptionsMenu (#654)', () => {
  test('the trigger marks that options are on with a dot (#1046)', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    const trigger = screen.getByRole('button', { name: /session options/i })
    // A presence dot now, not a number: the count lives in the title for a11y, the dot in the corner.
    expect(trigger.getAttribute('title')).toMatch(/\bon$/)
    expect(trigger.querySelector('span.rounded-full')).not.toBeNull()
    expect(trigger.textContent).not.toContain('1') // no number in the badge anymore
  })

  test('toggling an item writes the new value through', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    open()
    fireEvent.click(screen.getByText('Autopilot'))
    expect(updatePreferences).toHaveBeenCalledWith({ autopilot: true })
  })

  test('hides the Eco sub-drops when Eco does not apply', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    open()
    expect(screen.queryByText('Auto planning')).toBeNull()
  })

  test('shows the Eco sub-drops when Eco applies', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={true} busy={false} />)
    open()
    expect(screen.getByText('Auto planning')).toBeTruthy()
  })

  test('a disabled row is greyed out and says why, and cannot be toggled', () => {
    const options: OptionRow[] = [
      { key: 'browser', label: 'Browser', title: 't', description: 'Gives the agent a real browser.', checked: false, disabled: true, disabledReason: 'only on Claude Code' },
    ]
    render(<OptionsMenu options={options} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    open()
    expect(screen.getByText(/only on Claude Code/)).toBeTruthy()
    fireEvent.click(screen.getByText('Browser'))
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  test('a disabled Eco sub-drop cannot be toggled either (#801)', () => {
    // The sub-rows rendered the reason but stayed clickable, so a gated one (Auto maintenance under
    // Post-merge cleanup) would have looked disabled and still written through.
    const eco: OptionRow[] = [
      { key: 'ecoMaintenance', label: 'Auto maintenance', title: 't', checked: false, disabled: true, disabledReason: 'only applies while Post-merge cleanup is on' },
    ]
    render(<OptionsMenu options={mainOptions()} ecoOptions={eco} showEco={true} busy={false} />)
    open()
    expect(screen.getByText(/only applies while Post-merge cleanup is on/)).toBeTruthy()
    fireEvent.click(screen.getByText('Auto maintenance'))
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  test('the Run on submenu picks a target and calls back (#1050)', () => {
    const onChange = vi.fn()
    render(
      <OptionsMenu
        options={mainOptions()}
        ecoOptions={ecoOptions()}
        showEco={false}
        busy={false}
        runTarget={{ value: 'local', onChange }}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Run on'))
    fireEvent.click(screen.getByText('GitHub Actions'))
    expect(onChange).toHaveBeenCalledWith('actions')
  })

  test('the Run on submenu is absent when no target control is passed (in-session) (#1050)', () => {
    render(<OptionsMenu options={[]} ecoOptions={[]} showEco={false} busy={false} />)
    open()
    expect(screen.queryByText('Run on')).toBeNull()
  })

  const profiles = (): ConnectionProfile[] => [
    { id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200', token: 'aaa' },
  ]
  const connectionControl = (over: Partial<ConnectionControl> = {}): ConnectionControl => ({
    profiles: profiles(),
    currentUrl: 'http://127.0.0.1:4200',
    isLocal: true,
    selectedDeviceId: null,
    onSelect: vi.fn(),
    onSelectDriver: vi.fn(),
    onConnectLocal: vi.fn(),
    onAddDevice: vi.fn(),
    ...over,
  })

  // Rows are matched by tokens that never appear in the sub-trigger summary (unique descriptions,
  // or the device url), so the summary echoing a driver/device label can't make a query ambiguous.
  const THIS_MACHINE = 'Run on this machine, as today.'
  const ACTIONS = 'Run on a fresh GitHub Actions runner.'
  const STUDIO_URL = 'http://192.168.1.5:4200'
  const rowOf = (token: string): HTMLElement => screen.getByText(token).closest('[role="menuitem"]') as HTMLElement
  const isChecked = (token: string): boolean => !!rowOf(token).querySelector('svg')?.classList.contains('opacity-100')

  function openRunOn(connection: ConnectionControl, value: RunTarget = 'local') {
    render(
      <OptionsMenu options={[]} ecoOptions={[]} showEco={false} busy={false} runTarget={{ value, onChange: vi.fn() }} connection={connection} />,
    )
    open()
    fireEvent.click(screen.getByText('Run on'))
  }

  test('Run on is one flat list, no "A device I have" header and no separate "Local" row (#1066)', () => {
    openRunOn(connectionControl())
    // The old two-axis framing is gone: no section header, no redundant "Local" duplicating this machine.
    expect(screen.queryByText('A device I have')).toBeNull()
    expect(screen.queryByText('Local')).toBeNull()
    // The whole list renders as one: driver rows (renamed), the disabled placeholder, the device, and Add.
    expect(screen.getByText(THIS_MACHINE)).toBeTruthy()
    expect(screen.getByText(ACTIONS)).toBeTruthy()
    expect(screen.getByText('Claude web')).toBeTruthy()
    expect(screen.getByText(STUDIO_URL)).toBeTruthy()
    expect(screen.getByText('Add a device…')).toBeTruthy()
    // Claude web stays a disabled placeholder for the sibling axis that has not shipped.
    expect(rowOf('Claude web').hasAttribute('data-disabled')).toBe(true)
  })

  test('on the local daemon with no device picked, the checkmark tracks the driver target (#1066)', () => {
    openRunOn(connectionControl({ isLocal: true, selectedDeviceId: null }), 'actions')
    expect(isChecked(ACTIONS)).toBe(true) // the selected driver target
    expect(isChecked(THIS_MACHINE)).toBe(false)
    expect(isChecked(STUDIO_URL)).toBe(false) // no device is the target
  })

  test('selecting a device puts the checkmark on it and quiets the driver rows (#1067)', () => {
    // On the local daemon, a selected device is the run target in place, with no navigation involved.
    openRunOn(connectionControl({ isLocal: true, selectedDeviceId: STUDIO_URL }), 'actions')
    expect(isChecked(STUDIO_URL)).toBe(true)
    expect(isChecked(THIS_MACHINE)).toBe(false)
    expect(isChecked(ACTIONS)).toBe(false) // the driver target no longer carries the mark
  })

  test('connected to a device the checkmark is on that device, driver rows quiet (#1066)', () => {
    openRunOn(connectionControl({ isLocal: false, currentUrl: STUDIO_URL }), 'local')
    expect(isChecked(STUDIO_URL)).toBe(true)
    expect(isChecked(THIS_MACHINE)).toBe(false)
    expect(isChecked(ACTIONS)).toBe(false)
  })

  test('clicking a device selects it as the run target (no navigation, no preference) (#1067)', () => {
    const onSelect = vi.fn()
    openRunOn(connectionControl({ onSelect }))
    fireEvent.click(rowOf(STUDIO_URL))
    expect(onSelect).toHaveBeenCalledWith(profiles()[0])
    // A device row is a run-target selection now, not a driver preference or a navigation.
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  test('clicking "This machine" while on a remote device goes home, not a driver write (#1066)', () => {
    const onConnectLocal = vi.fn()
    const onChange = vi.fn()
    render(
      <OptionsMenu
        options={[]}
        ecoOptions={[]}
        showEco={false}
        busy={false}
        runTarget={{ value: 'local', onChange }}
        connection={connectionControl({ isLocal: false, currentUrl: STUDIO_URL, onConnectLocal })}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Run on'))
    fireEvent.click(rowOf(THIS_MACHINE))
    expect(onConnectLocal).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('clicking "This machine" on the local daemon writes the driver target and clears any device (#1066/#1067)', () => {
    const onConnectLocal = vi.fn()
    const onSelectDriver = vi.fn()
    const onChange = vi.fn()
    render(
      <OptionsMenu
        options={[]}
        ecoOptions={[]}
        showEco={false}
        busy={false}
        runTarget={{ value: 'actions', onChange }}
        connection={connectionControl({ isLocal: true, selectedDeviceId: STUDIO_URL, onConnectLocal, onSelectDriver })}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Run on'))
    fireEvent.click(rowOf(THIS_MACHINE))
    expect(onChange).toHaveBeenCalledWith('local')
    expect(onSelectDriver).toHaveBeenCalled() // a driver row clears the device selection (#1067)
    expect(onConnectLocal).not.toHaveBeenCalled()
  })

  test('Add a device opens the add flow (#1066)', () => {
    const onAddDevice = vi.fn()
    openRunOn(connectionControl({ onAddDevice }))
    fireEvent.click(screen.getByText('Add a device…'))
    expect(onAddDevice).toHaveBeenCalled()
  })

  test('the device rows are absent without a connection control (#1066)', () => {
    render(<OptionsMenu options={[]} ecoOptions={[]} showEco={false} busy={false} runTarget={{ value: 'local', onChange: vi.fn() }} />)
    open()
    fireEvent.click(screen.getByText('Run on'))
    expect(screen.queryByText(STUDIO_URL)).toBeNull()
    expect(screen.queryByText('Add a device…')).toBeNull()
  })
})
