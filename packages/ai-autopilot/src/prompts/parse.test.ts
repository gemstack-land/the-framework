import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parsePrompt, PromptError } from './parse.js'

const bundle = (front: string, body = 'Do the thing.') => `---\n${front}\n---\n${body}`

describe('parsePrompt', () => {
  it('parses frontmatter + body with sensible defaults', () => {
    const p = parsePrompt(bundle('name: review-tldr\ndescription: fast review'))
    assert.equal(p.id, 'review-tldr') // defaults to name
    assert.equal(p.name, 'review-tldr')
    assert.equal(p.title, 'review-tldr') // defaults to name
    assert.equal(p.passes, 1)
    assert.equal(p.instructions, 'Do the thing.')
    assert.equal('event' in p, false)
    assert.ok(Object.isFrozen(p))
  })

  it('reads loopId, title, passes, and event from metadata', () => {
    const p = parsePrompt(
      bundle('name: review-thorough\ndescription: d\nmetadata:\n  loopId: review\n  title: Thorough review\n  passes: 2\n  event: major-change'),
    )
    assert.equal(p.id, 'review')
    assert.equal(p.title, 'Thorough review')
    assert.equal(p.passes, 2)
    assert.equal(p.event, 'major-change')
  })

  it('throws on an empty body, a bad passes count, or a non-kebab id', () => {
    assert.throws(() => parsePrompt(bundle('name: x\ndescription: d', '   ')), PromptError)
    assert.throws(
      () => parsePrompt(bundle('name: x\ndescription: d\nmetadata:\n  passes: 0')),
      PromptError,
    )
    assert.throws(
      () => parsePrompt(bundle('name: x\ndescription: d\nmetadata:\n  loopId: Not_Kebab')),
      PromptError,
    )
  })
})
