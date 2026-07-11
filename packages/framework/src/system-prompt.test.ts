import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadUserSystemPrompt,
  renderSystemPrompt,
  systemPromptBlock,
  SYSTEM_PROMPT_FILE,
  SYSTEM_PROMPT_TEMPLATE,
} from './system-prompt.js'

test('loadUserSystemPrompt reads and trims SYSTEM.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'system-prompt-'))
  try {
    await writeFile(join(dir, SYSTEM_PROMPT_FILE), '\n  Always write tests first.\n')
    assert.equal(await loadUserSystemPrompt(dir), 'Always write tests first.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadUserSystemPrompt is undefined when the file is absent or empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'system-prompt-'))
  try {
    assert.equal(await loadUserSystemPrompt(dir), undefined) // absent
    await writeFile(join(dir, SYSTEM_PROMPT_FILE), '   \n') // whitespace only
    assert.equal(await loadUserSystemPrompt(dir), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('SYSTEM_PROMPT_TEMPLATE carries the #326 sections verbatim', () => {
  for (const section of ['## Unclear scope', '## Large scope', '## Alternatives', '## Maintenance', '# User prompt']) {
    assert.ok(SYSTEM_PROMPT_TEMPLATE.includes(section), `missing ${section}`)
  }
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('TODO_FILE: `TODO_<SESSION_NAME>.agent.md`'))
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('${{tf.prompt}}'))
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('${{ tf.params.autopilot ?'))
})

test('renderSystemPrompt splits the system and user halves', () => {
  const { system, user } = renderSystemPrompt({ prompt: 'build a todo app', params: {} })
  assert.ok(system.startsWith('# System prompt'))
  assert.ok(system.includes('## Maintenance'))
  assert.ok(!system.includes('# User prompt'))
  assert.ok(!system.includes('${{'), 'system half fully rendered')
  assert.equal(user, 'build a todo app')
})

test('renderSystemPrompt branches the maintenance line on tf.params.autopilot', () => {
  const attended = renderSystemPrompt({ prompt: 'x', params: { autopilot: false } }).system
  const autopilot = renderSystemPrompt({ prompt: 'x', params: { autopilot: true } }).system
  assert.ok(attended.includes('prefer minimal changes to make it easier for humans to read the changes'))
  assert.ok(autopilot.includes('you can prefer minimal changes (e.g. to postpone a deep refactor)'))
  assert.ok(!autopilot.includes('easier for humans'))
})

test('renderSystemPrompt is not confused by a user prompt containing the heading', () => {
  const sneaky = 'do X\n# User prompt\ndo Y'
  const { system, user } = renderSystemPrompt({ prompt: sneaky, params: {} })
  assert.ok(system.startsWith('# System prompt'))
  assert.equal(user, sneaky)
})

test('systemPromptBlock defaults to the built-in #326 prompt alone', () => {
  assert.equal(systemPromptBlock(), renderSystemPrompt().system)
})

test('systemPromptBlock appends the user prompt after the built-in one', () => {
  const block = systemPromptBlock({ user: 'Ship small PRs.' })
  assert.ok(block.startsWith('# System prompt'))
  assert.ok(block.endsWith('Ship small PRs.'))
  assert.match(block, /AWAIT[\s\S]*Ship small PRs\./) // built-in first, then user
})

test('systemPromptBlock removes the built-in prompt when antiLazyPill is false', () => {
  assert.equal(systemPromptBlock({ antiLazyPill: false }), '')
  assert.equal(systemPromptBlock({ antiLazyPill: false, user: 'Only mine.' }), 'Only mine.')
})

test('systemPromptBlock ignores a whitespace-only user prompt', () => {
  assert.equal(systemPromptBlock({ user: '   ' }), renderSystemPrompt().system)
  assert.equal(systemPromptBlock({ antiLazyPill: false, user: '  \n ' }), '')
})

test('systemPromptBlock threads tf through to the template', () => {
  const block = systemPromptBlock({ tf: { prompt: 'x', params: { autopilot: true } } })
  assert.ok(block.includes('postpone a deep refactor'))
})
