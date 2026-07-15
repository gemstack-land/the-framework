import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  composeRunSystem,
  renderSystemPrompt,
  systemPromptBlock,
  SYSTEM_PROMPT_TEMPLATE,
} from './system-prompt.js'
import { loadUserSystemPrompt, SYSTEM_PROMPT_FILE } from './system-prompt-file.js'
import { AWAIT_PROTOCOL, SIGNAL_PROTOCOL } from './turn-gate.js'

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

test('systemPromptBlock prepends a Context line for the selected directories (#439)', () => {
  const block = systemPromptBlock({ antiLazyPill: false, user: 'Only mine.', context: ['/work/api', ' /work/ui '] })
  assert.equal(block, 'Context: /work/api, /work/ui\n\nOnly mine.') // trimmed + comma-joined, first
  assert.equal(systemPromptBlock({ antiLazyPill: false, user: 'x', context: [] }), 'x') // empty adds nothing
  assert.equal(systemPromptBlock({ antiLazyPill: false, user: 'x', context: ['  '] }), 'x') // blank entries dropped
})

test('systemPromptBlock is the #326 prompt and the user prompt, in that order, and nothing else (#457)', () => {
  // The bootstrap preamble was the last text here that was neither the #326 doc nor the
  // user's own. Measured on four live runs: #326 alone already stops an empty-dir build
  // for a plan, so the override earned nothing and outranked the doc.
  const block = systemPromptBlock({ user: 'Ship small PRs.', context: ['/work/api'] })
  assert.equal(block, ['Context: /work/api', renderSystemPrompt().system, 'Ship small PRs.'].join('\n\n'))
})

test('systemPromptBlock ignores a whitespace-only user prompt', () => {
  assert.equal(systemPromptBlock({ user: '   ' }), renderSystemPrompt().system)
  assert.equal(systemPromptBlock({ antiLazyPill: false, user: '  \n ' }), '')
})

test('systemPromptBlock threads tf through to the template', () => {
  const block = systemPromptBlock({ tf: { prompt: 'x', params: { autopilot: true } } })
  assert.ok(block.includes('postpone a deep refactor'))
})

test('eco.autoPlanning drops only the Large scope section (#314)', () => {
  const { system } = renderSystemPrompt({ prompt: 'x', params: { eco: { autoPlanning: true } } })
  assert.ok(!system.includes('## Large scope'))
  assert.ok(!system.includes('PLAN_<SESSION_NAME>'))
  // The neighbours survive, and the block spacing is intact.
  assert.ok(system.includes('## Unclear scope'))
  assert.ok(system.includes('## Alternatives'))
  assert.ok(system.includes('## Maintenance'))
  assert.ok(!system.includes('\n\n\n'))
})

test('eco.autoResearch drops only the Alternatives section (#314)', () => {
  const { system } = renderSystemPrompt({ prompt: 'x', params: { eco: { autoResearch: true } } })
  assert.ok(!system.includes('## Alternatives'))
  assert.ok(!system.includes('measure "variability"'))
  assert.ok(system.includes('## Large scope'))
  assert.ok(system.includes('## Maintenance'))
})

test('eco.autoMaintenance drops the trailing Maintenance section cleanly (#314)', () => {
  const { system, user } = renderSystemPrompt({ prompt: 'ship it', params: { eco: { autoMaintenance: true } } })
  assert.ok(!system.includes('## Maintenance'))
  assert.ok(system.includes('## Alternatives'))
  // The user half is untouched by eco, and no stray fragment survives the drop.
  assert.equal(user, 'ship it')
  assert.ok(!system.includes('${{'))
})

test('all three eco drops leave just the Unclear scope section (#314)', () => {
  const { system } = renderSystemPrompt({
    prompt: 'x',
    params: { eco: { autoPlanning: true, autoResearch: true, autoMaintenance: true } },
  })
  assert.ok(system.includes('## Unclear scope'))
  for (const gone of ['## Large scope', '## Alternatives', '## Maintenance']) {
    assert.ok(!system.includes(gone), `${gone} should be dropped`)
  }
})

test('no eco flags renders every section, and eco never touches the template', () => {
  const { system } = renderSystemPrompt({ prompt: 'x', params: { eco: {} } })
  for (const section of ['## Unclear scope', '## Large scope', '## Alternatives', '## Maintenance']) {
    assert.ok(system.includes(section), `missing ${section}`)
  }
  // The living #326 doc stays byte-identical regardless of eco.
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('## Large scope'))
})

test('vanilla (antiLazyPill false) wins over eco: no built-in prompt at all (#314)', () => {
  const block = systemPromptBlock({ antiLazyPill: false, tf: { prompt: 'x', params: { eco: { autoResearch: true } } } })
  assert.equal(block, '')
})

test('composeRunSystem is exactly the #326 block + both emit protocols, and nothing else (#547)', () => {
  // The one assembly path both runFramework and runPrompt go through. Exact equality is
  // the point: no persona, skill, or memory framing may ever be appended again.
  const system = composeRunSystem()
  assert.equal(system, [renderSystemPrompt().system, AWAIT_PROTOCOL, SIGNAL_PROTOCOL].join('\n\n'))
})

test('composeRunSystem appends nothing after the protocols, whatever the options (#547)', () => {
  // Every supported option feeds the #326 block; none of them can add a trailing section.
  const system = composeRunSystem({
    user: 'Ship small PRs.',
    context: ['/work/api'],
    tf: { prompt: 'build a todo app', params: { autopilot: true } },
  })
  const block = systemPromptBlock({
    user: 'Ship small PRs.',
    context: ['/work/api'],
    tf: { prompt: 'build a todo app', params: { autopilot: true } },
  })
  assert.equal(system, [block, AWAIT_PROTOCOL, SIGNAL_PROTOCOL].join('\n\n'))
  assert.ok(system.endsWith(SIGNAL_PROTOCOL), 'the signal protocol is the last thing in the channel')
})

test('composeRunSystem keeps the emit protocols even with the built-in prompt off (#500/#501)', () => {
  // The drift that #500 fixed, now pinned at the single assembly point: --vanilla drops the
  // #326 block, but the agent still gets the AWAIT + SIGNAL emit contract.
  const system = composeRunSystem({ antiLazyPill: false })
  assert.ok(!system.includes('# System prompt'), 'built-in #326 prompt is off')
  assert.equal(system, [AWAIT_PROTOCOL, SIGNAL_PROTOCOL].join('\n\n'))
})
