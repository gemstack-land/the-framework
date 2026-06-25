import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, agent, getMessageText } from '@gemstack/ai-sdk'
import { agentPlanner } from './planner.js'

describe('agentPlanner', () => {
  it('prompts the agent and parses a JSON subtask array', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWith('[{"description":"research the market"},{"description":"draft copy","worker":"writer"}]')
      const plan = agentPlanner(agent('You plan.'))
      const subtasks = await plan('Launch product X')
      assert.deepEqual(subtasks, [
        { description: 'research the market' },
        { description: 'draft copy', worker: 'writer' },
      ])
    } finally {
      fake.restore()
    }
  })

  it('tolerates a fenced JSON code block', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWith('```json\n[{"description":"only task"}]\n```')
      const subtasks = await agentPlanner(agent('plan'))('do it')
      assert.deepEqual(subtasks, [{ description: 'only task' }])
    } finally {
      fake.restore()
    }
  })

  it('puts the schema instruction and the task into the planning prompt', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWith('[]')
      await agentPlanner(agent('plan'))('summarize the quarterly numbers')
      const call = fake.getCalls()[0]!
      const text = call.messages.map(m => getMessageText(m.content)).join('\n')
      assert.match(text, /JSON array/)
      assert.match(text, /summarize the quarterly numbers/)
    } finally {
      fake.restore()
    }
  })
})
