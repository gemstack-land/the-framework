import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runDemo } from './demo.js'

test('a real third-party framework-* package is discovered and composed end-to-end (#190)', async () => {
  const out = await runDemo(() => {})

  // Discovery resolved + imported the installed package from this project, for real.
  assert.ok(out.discovered.includes('framework-hello'), 'framework-hello should be discovered from the workspace')
  assert.deepEqual(out.failed, [], 'no discovered package should fail to load')

  // Composition threaded its persona and its own skill into the agent frame.
  assert.equal(out.greeterComposed, true, 'the greeter persona should be framed')
  assert.equal(out.helloSkillComposed, true, 'the hello-guide skill pointer should be framed')

  // And the whole offline flow still ran to production-grade.
  assert.equal(out.productionGrade, true)
})
