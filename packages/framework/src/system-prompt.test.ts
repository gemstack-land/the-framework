import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  composeRunSystem,
  KNOWLEDGE_DOCS,
  renderSystemPrompt,
  systemPromptBlock,
  SYSTEM_PROMPT_TEMPLATE,
} from './system-prompt.js'
import { loadUserSystemPrompt, SYSTEM_PROMPT_FILE } from './system-prompt-file.js'

/** The knowledge docs as the commented bullets they render to (#559). */
const KNOWLEDGE_LINES = KNOWLEDGE_DOCS.map(d => `- \`${d.path}\` (${d.comment})`).join('\n')
/** The `Context:` block the #537 knowledge docs stand up on their own, with no dirs picked. */
const KNOWLEDGE_CONTEXT = `Context:\n${KNOWLEDGE_LINES}`
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
  for (const section of [
    '## Analyze the user prompt',
    '### Ambiguous prompt',
    '### Scope',
    '## Before starting changes',
    '### Session name',
    '## Before applying changes',
    '### Alternatives',
    '## After applying changes',
    '# User prompt',
  ]) {
    assert.ok(SYSTEM_PROMPT_TEMPLATE.includes(section), `missing ${section}`)
  }
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('TODO_FILE: `TODO_<SESSION_NAME>.agent.md`'))
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('ADD_ANALYSIS_ENTRY: Add entry to the ANLYSIS_RESULT.md list'))
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('${{tf.prompt}}'))
  // The whole block is the branch-free doc now: #326 moved the one `tf.params.autopilot`
  // ternary out with the maintenance section, so `tf.prompt` is the only fragment left.
  assert.equal(SYSTEM_PROMPT_TEMPLATE.match(/\$\{\{/g)?.length, 1)
})

test('SYSTEM_PROMPT_TEMPLATE no longer carries the pre-#326-rewrite headings (#555)', () => {
  // The 11-Jul draft's headings. They are what ECO_SECTION_HEADINGS used to match on, so
  // if one comes back the eco mapping below is the thing to re-check.
  for (const gone of ['## Unclear scope', '## Large scope', '## Maintenance']) {
    assert.ok(!SYSTEM_PROMPT_TEMPLATE.includes(gone), `${gone} should be gone`)
  }
})

test('renderSystemPrompt splits the system and user halves', () => {
  const { system, user } = renderSystemPrompt({ prompt: 'build a todo app', params: {} })
  assert.ok(system.startsWith('# System prompt'))
  assert.ok(system.includes('## Analyze the user prompt'))
  assert.ok(system.includes('## After applying changes'))
  assert.ok(!system.includes('# User prompt'))
  assert.ok(!system.includes('${{'), 'system half fully rendered')
  assert.equal(user, 'build a todo app')
})

test('renderSystemPrompt is not confused by a user prompt containing the heading', () => {
  const sneaky = 'do X\n# User prompt\ndo Y'
  const { system, user } = renderSystemPrompt({ prompt: sneaky, params: {} })
  assert.ok(system.startsWith('# System prompt'))
  assert.equal(user, sneaky)
})

test('systemPromptBlock defaults to the knowledge-doc context line + the built-in #326 prompt', () => {
  assert.equal(systemPromptBlock(), [KNOWLEDGE_CONTEXT, renderSystemPrompt().system].join('\n\n'))
})

test('systemPromptBlock appends the user prompt after the built-in one', () => {
  const block = systemPromptBlock({ user: 'Ship small PRs.' })
  assert.ok(block.startsWith(`${KNOWLEDGE_CONTEXT}\n\n# System prompt`))
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

test('systemPromptBlock puts the knowledge docs in context, after the user dirs (#537)', () => {
  const block = systemPromptBlock({ user: 'Only mine.', context: ['/work/api'] })
  assert.ok(block.startsWith(`Context: /work/api\n${KNOWLEDGE_LINES}\n\n`))
  // No dirs picked: the docs still stand up a Context block of their own.
  assert.ok(systemPromptBlock({}).startsWith(`${KNOWLEDGE_CONTEXT}\n\n`))
})

test('systemPromptBlock adds no knowledge docs when antiLazyPill is false (#537/#547)', () => {
  // `--vanilla` is "Disable system prompt": the docs are framework-authored context, so
  // they go with the built-in prompt. Only the user's own dirs survive it.
  assert.equal(systemPromptBlock({ antiLazyPill: false }), '')
  assert.equal(systemPromptBlock({ antiLazyPill: false, context: ['/work/api'] }), 'Context: /work/api')
})

test('systemPromptBlock is the #326 prompt and the user prompt, in that order, and nothing else (#457)', () => {
  // The bootstrap preamble was the last text here that was neither the #326 doc nor the
  // user's own. Measured on four live runs: #326 alone already stops an empty-dir build
  // for a plan, so the override earned nothing and outranked the doc.
  // The knowledge docs (#537) join the Context line, which is paths, not prompt text.
  const block = systemPromptBlock({ user: 'Ship small PRs.', context: ['/work/api'] })
  const context = `Context: /work/api\n${KNOWLEDGE_LINES}`
  assert.equal(block, [context, renderSystemPrompt().system, 'Ship small PRs.'].join('\n\n'))
})

test('systemPromptBlock ignores a whitespace-only user prompt', () => {
  assert.equal(systemPromptBlock({ user: '   ' }), [KNOWLEDGE_CONTEXT, renderSystemPrompt().system].join('\n\n'))
  assert.equal(systemPromptBlock({ antiLazyPill: false, user: '  \n ' }), '')
})

test('systemPromptBlock threads tf through to the template', () => {
  // `tf.prompt` lands in the user half, so eco is what observably reaches the system half.
  const block = systemPromptBlock({ tf: { prompt: 'x', params: { eco: { autoResearch: true } } } })
  assert.ok(!block.includes('### Alternatives'))
})

test('every eco flag with a section still drops it (#314/#555)', () => {
  // The regression this exists for: the mapping matches by exact heading string and
  // dropSection() no-ops on a miss, so renaming a heading in the #326 doc silently stops a
  // flag from trimming anything. A `!system.includes('## Large scope')` assertion cannot
  // catch that, because it passes for free once the heading is gone. Assert the drop really
  // shortens the prompt instead.
  const full = renderSystemPrompt({ prompt: 'x', params: {} }).system
  for (const flag of ['autoPlanning', 'autoResearch'] as const) {
    const trimmed = renderSystemPrompt({ prompt: 'x', params: { eco: { [flag]: true } } }).system
    assert.ok(trimmed.length < full.length, `eco.${flag} dropped nothing`)
  }
})

test('eco.autoPlanning drops only the Scope section (#314)', () => {
  const { system } = renderSystemPrompt({ prompt: 'x', params: { eco: { autoPlanning: true } } })
  assert.ok(!system.includes('### Scope'))
  assert.ok(!system.includes('PLAN_<SESSION_NAME>'))
  assert.ok(!system.includes('whether the scope is small, large, or very large'))
  // The `##` parent, the `###` sibling above it, and the section after it all survive: the
  // drop stops at the next same-or-higher heading rather than running past it.
  assert.ok(system.includes('## Analyze the user prompt'))
  assert.ok(system.includes('### Ambiguous prompt'))
  assert.ok(system.includes('whether YES/NO the prompt is ambiguous'))
  assert.ok(system.includes('## Before starting changes'))
  assert.ok(system.includes('### Alternatives'))
})

test('eco.autoResearch drops only the Alternatives section (#314)', () => {
  const { system } = renderSystemPrompt({ prompt: 'x', params: { eco: { autoResearch: true } } })
  assert.ok(!system.includes('### Alternatives'))
  assert.ok(!system.includes('Measure "variability"'))
  // Its `##` parent stays, and so does the section after it.
  assert.ok(system.includes('## Before applying changes'))
  assert.ok(system.includes('## After applying changes'))
  assert.ok(system.includes('### Scope'))
})

test('eco.autoMaintenance drops nothing here: #326 moved the section to the on-before-mergeable prompt (#555/#556)', () => {
  // Not a silent breakage but a deliberate no-op on *this* prompt: the maintenance text left
  // the system prompt, so the tokens are already saved for everyone. The flag acts on the
  // on-before-mergeable prompt instead, where the CLI skips it (#556).
  const { system, user } = renderSystemPrompt({ prompt: 'ship it', params: { eco: { autoMaintenance: true } } })
  assert.equal(system, renderSystemPrompt({ prompt: 'ship it', params: {} }).system)
  assert.equal(user, 'ship it') // the user half is untouched by eco
  assert.ok(!system.includes('${{'))
})

test('both eco drops leave the rest of the prompt standing (#314)', () => {
  const { system } = renderSystemPrompt({
    prompt: 'x',
    params: { eco: { autoPlanning: true, autoResearch: true, autoMaintenance: true } },
  })
  for (const kept of ['## Analyze the user prompt', '### Ambiguous prompt', '### Session name', '## After applying changes']) {
    assert.ok(system.includes(kept), `missing ${kept}`)
  }
  for (const gone of ['### Scope', '### Alternatives']) {
    assert.ok(!system.includes(gone), `${gone} should be dropped`)
  }
})

test('no eco flags renders every section, and eco never touches the template', () => {
  const { system } = renderSystemPrompt({ prompt: 'x', params: { eco: {} } })
  for (const section of ['## Analyze the user prompt', '### Scope', '### Alternatives', '## After applying changes']) {
    assert.ok(system.includes(section), `missing ${section}`)
  }
  // The living #326 doc stays byte-identical regardless of eco.
  assert.ok(SYSTEM_PROMPT_TEMPLATE.includes('### Scope'))
})

test('vanilla (antiLazyPill false) wins over eco: no built-in prompt at all (#314)', () => {
  const block = systemPromptBlock({ antiLazyPill: false, tf: { prompt: 'x', params: { eco: { autoResearch: true } } } })
  assert.equal(block, '')
})

test('composeRunSystem is exactly the #326 block + both emit protocols, and nothing else (#547)', () => {
  // The one assembly path both runFramework and runPrompt go through. Exact equality is
  // the point: no persona, skill, or memory framing may ever be appended again. The #537
  // knowledge docs are in front of that, on the #439 context line: paths, not prompt text.
  const system = composeRunSystem()
  assert.equal(system, [KNOWLEDGE_CONTEXT, renderSystemPrompt().system, AWAIT_PROTOCOL, SIGNAL_PROTOCOL].join('\n\n'))
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

test('composeRunSystem is empty under transparent mode — no prompt, no emit protocols (#625)', () => {
  // Transparent (#625) is stronger than --vanilla: the whole system channel is dropped, protocols
  // included, so the agent runs as raw `claude -p`. It overrides every other option.
  assert.equal(composeRunSystem({ transparent: true }), '')
  assert.equal(
    composeRunSystem({ transparent: true, antiLazyPill: true, user: 'ignored', context: ['/work/api'] }),
    '',
  )
})
