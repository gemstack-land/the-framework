import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { dynamicTool, type AnyTool } from '@gemstack/ai-sdk'
import type { LoadedSkill } from '@gemstack/ai-skills'
import { definePersona } from './define.js'
import {
  personaInstructions,
  personaTools,
  personaAgent,
  personaWorkers,
  personaRoster,
} from './compose.js'
import { stackPersonas } from './library.js'

function fakeTool(name: string): AnyTool {
  return dynamicTool({ name, description: name, inputSchema: z.object({}) }).server(
    async () => 'ok',
  ) as unknown as AnyTool
}

function fakeSkill(name: string, instructions: string, tools: AnyTool[] = []): LoadedSkill {
  return {
    manifest: { name, description: name },
    instructions,
    tools,
    resources: [],
  }
}

describe('personaInstructions', () => {
  it('puts the systemPrompt first, then skill bodies under headers', () => {
    const p = definePersona({
      name: 'p',
      role: 'r',
      systemPrompt: 'BASE IDENTITY',
      skills: [fakeSkill('refunds', 'HOW TO REFUND')],
    })
    const out = personaInstructions(p)
    assert.ok(out.startsWith('BASE IDENTITY'), 'systemPrompt leads')
    assert.match(out, /# Skill: refunds/)
    assert.match(out, /HOW TO REFUND/)
  })

  it('is just the systemPrompt when there are no skills', () => {
    const p = definePersona({ name: 'p', role: 'r', systemPrompt: 'ONLY THIS' })
    assert.equal(personaInstructions(p), 'ONLY THIS')
  })
})

describe('personaTools', () => {
  it('unions own tools with skill tools; own tools win a name collision', () => {
    const p = definePersona({
      name: 'orders',
      role: 'r',
      systemPrompt: 's',
      tools: [fakeTool('lookup')],
      skills: [fakeSkill('refunds', '', [fakeTool('lookup'), fakeTool('refund')])],
    })
    const names = personaTools(p).map(t => t.definition.name)
    assert.deepEqual(names.slice(0, 1), ['lookup']) // own tool first, authoritative
    assert.ok(names.includes('refund'))
    // colliding skill tool is namespaced, not dropped
    assert.ok(names.some(n => n.includes('lookup') && n !== 'lookup'))
  })
})

describe('personaAgent', () => {
  it('materializes an agent carrying the composed instructions and tools', () => {
    const p = definePersona({
      name: 'p',
      role: 'r',
      systemPrompt: 'BASE',
      tools: [fakeTool('go')],
      skills: [fakeSkill('s', 'SKILL BODY')],
    })
    const a = personaAgent(p, { model: 'anthropic/claude-sonnet-4-5' }) as unknown as {
      instructions(): string
      tools(): AnyTool[]
      model(): string | undefined
    }
    assert.match(a.instructions(), /BASE/)
    assert.match(a.instructions(), /SKILL BODY/)
    assert.deepEqual(a.tools().map(t => t.definition.name), ['go'])
    assert.equal(a.model(), 'anthropic/claude-sonnet-4-5')
  })
})

describe('personaWorkers', () => {
  it('keys agents by persona name', () => {
    const workers = personaWorkers(stackPersonas)
    assert.deepEqual(
      Object.keys(workers).sort(),
      ['data-modeler', 'ui-intent-designer', 'vike-page-builder'],
    )
  })

  it('throws on a duplicate persona name', () => {
    const p = definePersona({ name: 'dup', role: 'r', systemPrompt: 's' })
    assert.throws(() => personaWorkers([p, p]), /duplicate persona name/)
  })
})

describe('personaRoster', () => {
  it('lists each persona name + role for a planner to route on', () => {
    const roster = personaRoster(stackPersonas)
    assert.match(roster, /`vike-page-builder`/)
    assert.match(roster, /`data-modeler`/)
    assert.match(roster, /`ui-intent-designer`/)
    assert.match(roster, /worker/)
  })

  it('handles an empty list', () => {
    assert.match(personaRoster([]), /No personas/)
  })
})
