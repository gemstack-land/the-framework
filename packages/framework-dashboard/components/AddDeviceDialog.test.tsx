import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AddDeviceDialog } from './AddDeviceDialog.js'
import { listProfiles } from '../lib/profiles.js'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('AddDeviceDialog (#1052)', () => {
  test('pasting a ?token= URL saves a profile and closes', () => {
    const onClose = vi.fn()
    const onAdded = vi.fn()
    render(<AddDeviceDialog onClose={onClose} onAdded={onAdded} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://192.168.1.5:4200/?token=abc123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
    expect(listProfiles()).toEqual([
      { id: 'http://192.168.1.5:4200', label: '192.168.1.5:4200', url: 'http://192.168.1.5:4200', token: 'abc123' },
    ])
    expect(onAdded).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  test('a URL without a token cannot be saved', () => {
    render(<AddDeviceDialog onClose={vi.fn()} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://192.168.1.5:4200' } })
    expect((screen.getByRole('button', { name: 'Add device' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/no token/i)).toBeTruthy()
  })

  test('an optional label overrides the host default', () => {
    render(<AddDeviceDialog onClose={vi.fn()} onAdded={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/), { target: { value: 'http://box:4200/?token=xyz' } })
    fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'Workshop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
    expect(listProfiles()[0]!.label).toBe('Workshop')
  })
})
