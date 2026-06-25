import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, toolDefinition, getMessageText } from '@gemstack/ai-sdk'
import { z } from 'zod'
import { SkillfulAgent } from './skillful-agent.js'
import type { LoadedSkill } from './types.js'

function tool(name: string, description = name) {
  return toolDefinition({ name, description, inputSchema: z.object({}) }).server(async () => 'ok')
}

function skill(name: string, instructions: string, tools: ReturnType<typeof tool>[] = []): LoadedSkill {
  return { manifest: { name, description: `${name} skill` }, instructions, tools, resources: [] }
}

const refunds = skill('refunds', 'Always verify the order before refunding.', [tool('issue_refund')])

class SupportAgent extends SkillfulAgent {
  baseInstructions() { return 'You are a support agent.' }
  override skills() { return [refunds] }
  override baseTools() { return [tool('escalate')] }
}

describe('SkillfulAgent composition (sync hooks ai-sdk reads)', () => {
  it('instructions() = base identity then each skill', () => {
    const out = new SupportAgent().instructions()
    assert.ok(out.startsWith('You are a support agent.'))
    assert.ok(out.includes('# Skill: refunds'))
    assert.ok(out.includes('Always verify the order before refunding.'))
  })

  it('tools() unions own tools with skill tools', () => {
    const names = new SupportAgent().tools().map(t => t.definition.name)
    assert.deepEqual(names.sort(), ['escalate', 'issue_refund'])
  })

  it('own tool wins a name collision; the skill tool is namespaced', () => {
    class Collide extends SkillfulAgent {
      baseInstructions() { return 'base' }
      override skills() { return [skill('s', '', [tool('escalate', 'from skill')])] }
      override baseTools() { return [tool('escalate', 'from agent')] }
    }
    const tools = new Collide().tools()
    assert.equal(tools.find(t => t.definition.name === 'escalate')?.definition.description, 'from agent')
    assert.ok(tools.some(t => t.definition.name === 's__escalate'))
  })

  it('defaults to no skills / no tools when only baseInstructions is given', () => {
    class Plain extends SkillfulAgent {
      baseInstructions() { return 'Just me.' }
    }
    const a = new Plain()
    assert.equal(a.instructions(), 'Just me.')
    assert.deepEqual(a.tools(), [])
    assert.deepEqual(a.middleware(), [])
  })
})

describe('SkillfulAgent through the agent loop', () => {
  it('ai-sdk sends the composed system prompt and skill tools to the provider', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWith('done')
      await new SupportAgent().prompt('refund order #1')

      const call = fake.getCalls()[0]
      assert.ok(call, 'provider should have been called')

      const systemMsg = call.messages.find(m => m.role === 'system')
      const system = systemMsg ? getMessageText(systemMsg.content) : ''
      assert.ok(system.includes('You are a support agent.'), 'base identity reached the provider')
      assert.ok(system.includes('Always verify the order before refunding.'), 'skill instructions reached the provider')

      const toolNames = (call.tools ?? []).map(t => t.name).sort()
      assert.deepEqual(toolNames, ['escalate', 'issue_refund'])
    } finally {
      fake.restore()
    }
  })
})
