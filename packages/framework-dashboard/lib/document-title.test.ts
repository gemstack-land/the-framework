import { describe, expect, it } from 'vitest'
import { frameworkTitle } from './document-title.js'

describe('frameworkTitle', () => {
  it('is the bare brand with no count and no project', () => {
    expect(frameworkTitle(0)).toBe('The Framework')
    expect(frameworkTitle(0, null)).toBe('The Framework')
  })

  it('prefixes the needs-you count when there is one', () => {
    expect(frameworkTitle(2)).toBe('(2) The Framework')
  })

  it('scopes to the selected project', () => {
    expect(frameworkTitle(0, 'gemstack')).toBe('gemstack — The Framework')
  })

  it('combines the count and the project', () => {
    expect(frameworkTitle(2, 'gemstack')).toBe('(2) gemstack — The Framework')
  })

  it('drops the count when zero', () => {
    expect(frameworkTitle(0, 'gemstack')).toBe('gemstack — The Framework')
  })
})
