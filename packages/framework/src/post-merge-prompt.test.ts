import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderPostMergePrompt, POST_MERGE_PROMPT_TEMPLATE } from './post-merge-prompt.js'
import { TemplateFragmentError } from './prompt-template.js'
import { KNOWLEDGE_DOCS } from './system-prompt.js'

test('POST_MERGE_PROMPT_TEMPLATE carries the #326 post-merge block', () => {
  assert.ok(POST_MERGE_PROMPT_TEMPLATE.includes('TODO_FILE: `TODO_<SESSION_NAME>.agent.md`'))
  assert.ok(POST_MERGE_PROMPT_TEMPLATE.includes('## Maintenance'))
  for (const preset of ['maintainability', 'readability', 'security_audit']) {
    assert.ok(POST_MERGE_PROMPT_TEMPLATE.includes(`Apply preset \`${preset}\``), `missing ${preset}`)
  }
})

test('the business-knowledge section names every knowledge doc (#537)', () => {
  // The two halves of #537 are authored apart: `## Context` lists the docs from the
  // KNOWLEDGE_DOCS const, this prompt names them as markdown. Pin them together, or the
  // agent gets told to read one set of files and update another.
  assert.ok(POST_MERGE_PROMPT_TEMPLATE.includes('## Business knowledge'))
  for (const doc of KNOWLEDGE_DOCS) {
    assert.ok(POST_MERGE_PROMPT_TEMPLATE.includes(`\`${doc.path}\``), `missing ${doc.path}`)
  }
})

test('eco.autoMaintenance drops the maintenance section and keeps the rest (#314/#537)', () => {
  const prompt = renderPostMergePrompt({ session_name: 'add-oauth' }, { autoMaintenance: true })
  assert.ok(!prompt.includes('## Maintenance'))
  assert.ok(!prompt.includes('Apply preset'), 'the preset entries go with the section')
  // The flag names maintenance only, so business knowledge must survive it.
  assert.ok(prompt.includes('## Business knowledge'))
  assert.ok(prompt.includes('add-oauth'))
  assert.ok(!prompt.includes('${{'), 'the dropped section takes its fragments with it')
  // Absent/off eco leaves the prompt whole.
  assert.ok(renderPostMergePrompt({ session_name: 'x' }, {}).includes('## Maintenance'))
  assert.ok(renderPostMergePrompt({ session_name: 'x' }).includes('## Maintenance'))
})

test('the template never nests a fragment inside another (#556)', () => {
  // The one place this prompt departs from the doc, and the reason why. `renderTemplate`'s
  // fragment regex is non-greedy, so an inner `${{ ... }}` closes the outer fragment early and
  // the leftover is not valid JS. The doc's version throws "Unexpected identifier". Pin it:
  // every fragment must be flat, or the whole prompt stops rendering at run time.
  for (const fragment of POST_MERGE_PROMPT_TEMPLATE.match(/\$\{\{[\s\S]*?\}\}/g) ?? []) {
    assert.ok(!fragment.slice(3).includes('${{'), `nested fragment: ${fragment}`)
  }
})

test('renderPostMergePrompt names the session on every entry', () => {
  const prompt = renderPostMergePrompt({ session_name: 'add-oauth' })
  assert.ok(!prompt.includes('${{'), 'fully rendered')
  assert.match(prompt, /Apply preset `maintainability` on the changes introduced by add-oauth/)
  assert.match(prompt, /Apply preset `security_audit` on the changes introduced by add-oauth/)
})

test('renderPostMergePrompt adds the readability entry only under technical control (#326)', () => {
  const on = renderPostMergePrompt({ session_name: 'add-oauth', settings: { technical_control: true } })
  const off = renderPostMergePrompt({ session_name: 'add-oauth', settings: { technical_control: false } })
  assert.match(on, /Apply preset `readability` on the changes introduced by add-oauth/)
  assert.doesNotMatch(off, /readability/)
  // The other two entries are unconditional either way.
  for (const prompt of [on, off]) {
    assert.match(prompt, /`maintainability`/)
    assert.match(prompt, /`security_audit`/)
  }
})

test('renderPostMergePrompt defaults absent settings to off rather than throwing (#556)', () => {
  // The template reads `tf.settings.technical_control`, so an absent `settings` would throw
  // on the property access rather than read as off.
  const prompt = renderPostMergePrompt({ session_name: 'add-oauth' })
  assert.doesNotMatch(prompt, /readability/)
  assert.equal(prompt, renderPostMergePrompt({ session_name: 'add-oauth', settings: {} }))
})

test('renderPostMergePrompt throws a useful error when the session name is missing (#556)', () => {
  // Rather than queueing "changes introduced by undefined". The CLI checks first; this is the
  // backstop for any other caller.
  assert.throws(
    () => renderPostMergePrompt({ session_name: undefined as unknown as string }),
    (err: unknown) => err instanceof TemplateFragmentError && /session_name/.test(err.message),
  )
})
