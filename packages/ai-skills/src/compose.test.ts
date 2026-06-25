import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toolDefinition } from '@gemstack/ai-sdk'
import type { AiMiddleware } from '@gemstack/ai-sdk'
import { z } from 'zod'
import { composeInstructions, composeTools, composeMiddleware, surface } from './compose.js'
import type { LoadedSkill } from './types.js'

function tool(name: string, description = name) {
  return toolDefinition({
    name,
    description,
    inputSchema: z.object({ x: z.string() }),
  }).server(async () => `${name}-result`)
}

function skill(name: string, instructions: string, tools: ReturnType<typeof tool>[] = [], extra: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    manifest: { name, description: `${name} skill` },
    instructions,
    tools,
    resources: [],
    ...extra,
  }
}

describe('composeInstructions', () => {
  it('puts the agent base first and appends each skill under a header', () => {
    const out = composeInstructions('You are an agent.', [
      skill('alpha', 'Do alpha things.'),
      skill('beta', 'Do beta things.'),
    ])
    assert.ok(out.startsWith('You are an agent.'))
    assert.ok(out.indexOf('# Skill: alpha') < out.indexOf('# Skill: beta'))
    assert.ok(out.includes('Do alpha things.'))
    assert.ok(out.includes('Do beta things.'))
  })

  it('omits skills with an empty instructions body', () => {
    const out = composeInstructions('Base.', [skill('toolsonly', '   ')])
    assert.equal(out, 'Base.')
  })
})

describe('composeTools', () => {
  it('keeps the agent own tools first and unchanged', () => {
    const own = [tool('escalate')]
    const out = composeTools(own, [skill('s', '', [tool('lookup')])])
    assert.deepEqual(out.map(t => t.definition.name), ['escalate', 'lookup'])
  })

  it('namespaces a colliding skill tool instead of dropping it; the own tool wins', () => {
    const own = [tool('search', 'agent search')]
    const out = composeTools(own, [skill('docs', '', [tool('search', 'skill search')])])
    assert.equal(out.length, 2)
    // own tool retains its name + description (authoritative)
    const ownTool = out.find(t => t.definition.name === 'search')!
    assert.equal(ownTool.definition.description, 'agent search')
    // skill tool survives, namespaced
    const renamed = out.find(t => t.definition.name === 'docs__search')!
    assert.equal(renamed.definition.description, 'skill search')
  })

  it('namespaces collisions between two skills (second skill yields)', () => {
    const out = composeTools([], [
      skill('a', '', [tool('run')]),
      skill('b', '', [tool('run')]),
    ])
    assert.deepEqual(out.map(t => t.definition.name).sort(), ['b__run', 'run'])
  })

  it('preserves a renamed tool execute fn', async () => {
    const out = composeTools([tool('dup')], [skill('s', '', [tool('dup')])])
    const renamed = out.find(t => t.definition.name === 's__dup')!
    const result = await renamed.execute!({ x: '' }, undefined as never)
    assert.equal(result, 'dup-result')
  })
})

describe('composeMiddleware', () => {
  it('runs agent middleware before skill middleware', () => {
    const mwOwn: AiMiddleware = { name: 'own' }
    const mwSkill: AiMiddleware = { name: 'skill' }
    const out = composeMiddleware([mwOwn], [skill('s', '', [], { middleware: [mwSkill] })])
    assert.deepEqual(out.map(m => m.name), ['own', 'skill'])
  })

  it('returns a copy when no skill contributes middleware', () => {
    const own = [{ name: 'own' } as AiMiddleware]
    const out = composeMiddleware(own, [skill('s', 'x')])
    assert.deepEqual(out.map(m => m.name), ['own'])
    assert.notEqual(out, own)
  })
})

describe('surface', () => {
  it('summarizes a skill without composing it', () => {
    const s = skill('refunds', 'Refund instructions.', [tool('issue_refund')], {
      manifest: { name: 'refunds', description: 'Refunds', trigger: 'a refund request' },
      resources: [{ name: 'policy.md', path: '/x/policy.md' }],
    })
    const summary = surface(s)
    assert.equal(summary.name, 'refunds')
    assert.equal(summary.trigger, 'a refund request')
    assert.deepEqual(summary.toolNames, ['issue_refund'])
    assert.deepEqual(summary.resourceNames, ['policy.md'])
    assert.equal(summary.instructionChars, 'Refund instructions.'.length)
  })
})
