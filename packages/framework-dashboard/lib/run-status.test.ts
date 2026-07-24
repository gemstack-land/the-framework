import { describe, expect, test } from 'vitest'
import type { FrameworkEvent } from '@gemstack/the-framework'
import { runStatusPill } from './run-status.js'

const named = { kind: 'session-name', name: 'relay smoke test' } as FrameworkEvent
const readyForMerge = { kind: 'ready-for-merge' } as FrameworkEvent
const ended = (over: Record<string, unknown>) => ({ kind: 'end', ...over }) as FrameworkEvent

describe('runStatusPill', () => {
  test('says nothing until the run has', () => {
    expect(runStatusPill([])).toBeNull()
    expect(runStatusPill([{ kind: 'log', message: 'working' } as FrameworkEvent])).toBeNull()
  })

  test('pulses while the run is live, settles when it ends', () => {
    expect(runStatusPill([named])).toMatchObject({ label: 'building…' })
    expect(runStatusPill([named, ended({ ok: true })])).toMatchObject({ label: 'finished' })
  })

  test('ready for merge, once the run signals it', () => {
    expect(runStatusPill([named, readyForMerge, ended({ ok: true })])).toMatchObject({ label: 'ready for merge' })
  })

  // The states are exclusive by construction — one run, one word. These two hold the facts at the
  // same time (the run said ready-for-merge, then was stopped / then failed), and how it ENDED
  // wins: the green would otherwise be a lie about a run that did not get there (#948).
  test('stopped outranks an earlier ready-for-merge', () => {
    expect(runStatusPill([named, readyForMerge, ended({ ok: false, stopped: true })])).toMatchObject({ label: 'stopped' })
  })

  test('failed outranks an earlier ready-for-merge, and carries the reason', () => {
    expect(runStatusPill([named, readyForMerge, ended({ ok: false, detail: 'exit 1' })])).toMatchObject({
      label: 'failed — exit 1',
    })
  })
})
