import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderTemplate, TemplateFragmentError } from './prompt-template.js'

test('renderTemplate passes fragment-free text through byte-identical', () => {
  const text = '# Title\n\nPlain `md` with ${single-brace} and $ signs.\n'
  assert.equal(renderTemplate(text, {}), text)
})

test('renderTemplate substitutes a simple context read', () => {
  const out = renderTemplate('User: ${{tf.prompt}}', { tf: { prompt: 'build a todo app' } })
  assert.equal(out, 'User: build a todo app')
})

test('renderTemplate evaluates the #326 maintenance ternary both ways', () => {
  const template = '${{ tf.params.autopilot ? "minimal ok" : "minimal for humans" }}'
  assert.equal(renderTemplate(template, { tf: { params: { autopilot: true } } }), 'minimal ok')
  assert.equal(renderTemplate(template, { tf: { params: { autopilot: false } } }), 'minimal for humans')
  assert.equal(renderTemplate(template, { tf: { params: {} } }), 'minimal for humans') // absent = off
})

test('renderTemplate renders several fragments in one template', () => {
  const out = renderTemplate('${{a}} + ${{b}} = ${{a + b}}', { a: 1, b: 2 })
  assert.equal(out, '1 + 2 = 3')
})

test('renderTemplate stringifies non-string results', () => {
  assert.equal(renderTemplate('n=${{40 + 2}}', {}), 'n=42')
  assert.equal(renderTemplate('b=${{false}}', {}), 'b=false')
})

test('renderTemplate keeps special replacement patterns in results literal', () => {
  // String.replace's `$&`-style patterns must not fire on the evaluated value.
  const out = renderTemplate('x ${{tf.prompt}} y', { tf: { prompt: 'give me $& and $1' } })
  assert.equal(out, 'x give me $& and $1 y')
})

test('renderTemplate throws a TemplateFragmentError on invalid JS', () => {
  assert.throws(() => renderTemplate('${{ this is not js }}', {}), TemplateFragmentError)
})

test('renderTemplate throws on a fragment that evaluates to undefined (typo guard)', () => {
  assert.throws(
    () => renderTemplate('${{tf.promt}}', { tf: { prompt: 'x' } }),
    (err: unknown) => err instanceof TemplateFragmentError && err.fragment === 'tf.promt',
  )
})

test('renderTemplate names the failing fragment in the error message', () => {
  try {
    renderTemplate('${{ nope( }}', {})
    assert.fail('expected a throw')
  } catch (err) {
    assert.ok(err instanceof TemplateFragmentError)
    assert.match(err.message, /nope\(/)
  }
})
