import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// The device health poll (#1072) reaches the daemon over Telefunc; hoisted so the factory below can
// close over it (a plain const is initialised after vi.mock hoists).
const checkDevices = vi.hoisted(() => vi.fn())
vi.mock('../server/devices.telefunc.js', () => ({ checkDevices }))

import { DevicesSettings } from './DevicesSettings.js'
import { addProfile, listProfiles } from '../lib/profiles.js'
import { selectRemoteDevice, getSelectedRemoteDeviceId } from '../lib/remote-target.js'

const STUDIO = 'http://192.168.1.5:4200'
const BOX = 'http://box.tail.ts:4200'

afterEach(() => {
  cleanup()
  localStorage.clear()
  selectRemoteDevice(null) // module-level state, so it outlives a test unless reset
  checkDevices.mockReset()
})

describe('DevicesSettings (#1052/#1072)', () => {
  test('says so when there are no devices, rather than showing an empty list', () => {
    checkDevices.mockResolvedValue({})
    render(<DevicesSettings />)
    expect(screen.getByText(/No devices saved/)).toBeTruthy()
  })

  test('lists each saved device with its origin', () => {
    checkDevices.mockResolvedValue({})
    addProfile({ url: STUDIO, token: 'aaa', label: 'Studio' })
    render(<DevicesSettings />)
    expect(screen.getByText('Studio')).toBeTruthy()
    expect(screen.getByText(STUDIO)).toBeTruthy()
  })

  test('removing a device drops it from storage', () => {
    checkDevices.mockResolvedValue({})
    addProfile({ url: STUDIO, token: 'aaa', label: 'Studio' })
    render(<DevicesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Studio'))

    expect(listProfiles()).toEqual([])
  })

  test('removing the device a run is targeting clears the run target (#1072)', () => {
    // The composer applies this guard on its own remove; managing the roster from settings has to
    // apply it too, or the next run points at a device that is no longer in the list.
    checkDevices.mockResolvedValue({})
    const studio = addProfile({ url: STUDIO, token: 'aaa', label: 'Studio' })
    selectRemoteDevice(studio.id)
    render(<DevicesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Studio'))

    expect(getSelectedRemoteDeviceId()).toBe(null)
  })

  test('removing some other device leaves the run target alone', () => {
    checkDevices.mockResolvedValue({})
    const studio = addProfile({ url: STUDIO, token: 'aaa', label: 'Studio' })
    addProfile({ url: BOX, token: 'bbb', label: 'Box' })
    selectRemoteDevice(studio.id)
    render(<DevicesSettings />)

    fireEvent.click(screen.getByLabelText('Remove Box'))

    expect(getSelectedRemoteDeviceId()).toBe(studio.id)
    expect(listProfiles().map(p => p.label)).toEqual(['Studio'])
  })
})
