import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderOnBeforeMergeablePrompt, ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE } from './on-before-mergeable-prompt.js'
import { TemplateFragmentError } from './prompt-template.js'
import { BUSINESS_KNOWLEDGE_DOCS } from './system-prompt.js'
import { FLAT_TODO_FILE } from './tickets.js'

test('ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE carries the #326 on-before-mergeable block', () => {
  // Derived from the constant, not a literal (#885) — see the same assertion in
  // system-prompt.test.ts. Both blocks declare TODO_FILE, so both can drift from the code.
  assert.ok(ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE.includes(`TODO_FILE: \`${FLAT_TODO_FILE}\``))
  assert.ok(ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE.includes('## Maintenance'))
  for (const preset of ['maintainability', 'readability', 'security_audit']) {
    assert.ok(ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE.includes(`tf.presets.${preset}.filePath`), `missing ${preset}`)
  }
})

test('the business-knowledge section names every business-knowledge doc (#537)', () => {
  // The two halves of #537 are authored apart: the `Context:` block lists the docs from the
  // BUSINESS_KNOWLEDGE_DOCS const, this prompt names them as markdown. Pin them together, or
  // the agent gets told to read one set of files and update another. Only the business-knowledge
  // subset is pinned: the broader CONTEXT_DOCS (#683) also lists roadmap/queue pointers the
  // agent reads but does not update at merge, so they are deliberately absent here.
  assert.ok(ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE.includes('## Business knowledge'))
  for (const doc of BUSINESS_KNOWLEDGE_DOCS) {
    assert.ok(ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE.includes(`\`${doc.path}\``), `missing ${doc.path}`)
  }
})

test('eco.autoMaintenance drops the maintenance section and keeps the rest (#314/#537)', () => {
  const prompt = renderOnBeforeMergeablePrompt({ session_name: 'add-oauth' }, { autoMaintenance: true })
  assert.ok(!prompt.includes('## Maintenance'))
  assert.ok(!prompt.includes('.the-framework/presets/'), 'the preset entries go with the section')
  // The flag names maintenance only, so business knowledge must survive it.
  assert.ok(prompt.includes('## Business knowledge'))
  assert.ok(prompt.includes('add-oauth'))
  assert.ok(!prompt.includes('${{'), 'the dropped section takes its fragments with it')
  // Absent/off eco leaves the prompt whole.
  assert.ok(renderOnBeforeMergeablePrompt({ session_name: 'x' }, {}).includes('## Maintenance'))
  assert.ok(renderOnBeforeMergeablePrompt({ session_name: 'x' }).includes('## Maintenance'))
})

test('the template never nests a fragment inside another (#556)', () => {
  // The one place this prompt departs from the doc, and the reason why. `renderTemplate`'s
  // fragment regex is non-greedy, so an inner `${{ ... }}` closes the outer fragment early and
  // the leftover is not valid JS. The doc's version throws "Unexpected identifier". Pin it:
  // every fragment must be flat, or the whole prompt stops rendering at run time.
  for (const fragment of ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE.match(/\$\{\{[\s\S]*?\}\}/g) ?? []) {
    assert.ok(!fragment.slice(3).includes('${{'), `nested fragment: ${fragment}`)
  }
})

test('renderOnBeforeMergeablePrompt names the session on every entry', () => {
  const prompt = renderOnBeforeMergeablePrompt({ session_name: 'add-oauth' })
  assert.ok(!prompt.includes('${{'), 'fully rendered')
  assert.match(prompt, /Apply \.the-framework\/presets\/maintainability\.md with tf\.params\.what set to "changes introduced by add-oauth"/)
  assert.match(prompt, /Apply \.the-framework\/presets\/security_audit\.md with tf\.params\.what set to "changes introduced by add-oauth"/)
})

test('renderOnBeforeMergeablePrompt adds the readability entry only under technical control (#326)', () => {
  const on = renderOnBeforeMergeablePrompt({ session_name: 'add-oauth', settings: { technical_control: true } })
  const off = renderOnBeforeMergeablePrompt({ session_name: 'add-oauth', settings: { technical_control: false } })
  assert.match(on, /Apply \.the-framework\/presets\/readability\.md with tf\.params\.what set to "changes introduced by add-oauth"/)
  assert.doesNotMatch(off, /readability/)
  // The other two entries are unconditional either way.
  for (const prompt of [on, off]) {
    assert.match(prompt, /maintainability\.md/)
    assert.match(prompt, /security_audit\.md/)
  }
})

test('renderOnBeforeMergeablePrompt defaults absent settings to off rather than throwing (#556)', () => {
  // The template reads `tf.settings.technical_control`, so an absent `settings` would throw
  // on the property access rather than read as off.
  const prompt = renderOnBeforeMergeablePrompt({ session_name: 'add-oauth' })
  assert.doesNotMatch(prompt, /readability/)
  assert.equal(prompt, renderOnBeforeMergeablePrompt({ session_name: 'add-oauth', settings: {} }))
})

test('renderOnBeforeMergeablePrompt throws a useful error when the session name is missing (#556)', () => {
  // Rather than queueing "changes introduced by undefined". The CLI checks first; this is the
  // backstop for any other caller.
  assert.throws(
    () => renderOnBeforeMergeablePrompt({ session_name: undefined as unknown as string }),
    (err: unknown) => err instanceof TemplateFragmentError && /session_name/.test(err.message),
  )
})
