import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { definePersona, PersonaError } from './define.js'

describe('definePersona', () => {
  it('trims fields and defaults optional arrays to empty', () => {
    const p = definePersona({
      name: 'my-persona',
      role: '  builds things  ',
      systemPrompt: '  you build things  ',
    })
    assert.equal(p.name, 'my-persona')
    assert.equal(p.role, 'builds things')
    assert.equal(p.systemPrompt, 'you build things')
    assert.deepEqual([...p.skills], [])
    assert.deepEqual([...p.tools], [])
    assert.deepEqual([...p.appliesTo], [])
  })

  it('freezes the persona so it cannot be mutated after definition', () => {
    const p = definePersona({ name: 'p', role: 'r', systemPrompt: 's' })
    assert.throws(() => {
      ;(p as { name: string }).name = 'other'
    })
    assert.throws(() => {
      ;(p.appliesTo as string[]).push('x')
    })
  })

  it('rejects a missing name', () => {
    assert.throws(() => definePersona({ name: '  ', role: 'r', systemPrompt: 's' }), PersonaError)
  })

  it('rejects a non-kebab-case name', () => {
    assert.throws(() => definePersona({ name: 'My Persona', role: 'r', systemPrompt: 's' }), PersonaError)
    assert.throws(() => definePersona({ name: 'my_persona', role: 'r', systemPrompt: 's' }), PersonaError)
  })

  it('rejects a missing role or systemPrompt', () => {
    assert.throws(() => definePersona({ name: 'p', role: '', systemPrompt: 's' }), PersonaError)
    assert.throws(() => definePersona({ name: 'p', role: 'r', systemPrompt: '  ' }), PersonaError)
  })
})
