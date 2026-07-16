import assert from 'node:assert/strict'
import { test } from 'node:test'
import { continuationPrompt, isDeclinedConfirmation, parseAwaitGate, parseChoicesGate, parseConfirmationGate, parseMarkdownViews, parseMultiSelectGate, parseSessionName, parseReadyForMerge } from './turn-gate.js'

const block = (json: string): string => 'Here are the options.\n```await-choices\n' + json + '\n```'
const multiBlock = (json: string): string => 'Pick some.\n```await-multiselect\n' + json + '\n```'
const confirmBlock = (json: string): string => 'Wrote the plan.\n```await-confirmation\n' + json + '\n```'

test('parseChoicesGate returns undefined when the agent did not stop to ask (#337)', () => {
  assert.equal(parseChoicesGate('Built the whole app. Done.'), undefined)
})

test('continuationPrompt is one wording for every path, carrying the title and the pick (#570)', () => {
  const prompt = continuationPrompt('Which data store?', 'Postgres')
  assert.match(prompt, /You paused to ask: "Which data store\?"/)
  assert.match(prompt, /The user chose: Postgres/)
  // No caller-specific clause ("backlog entry" / "building X"): the same string everywhere.
  assert.equal(prompt, continuationPrompt('Which data store?', 'Postgres'))
  assert.doesNotMatch(prompt, /backlog entry|Continue building/)
  // No "do not ask again" babysitting tail (#570 review): a capable agent handles that itself.
  assert.doesNotMatch(prompt, /do not ask again/)
})

test('parseChoicesGate parses a well-formed await-choices block (#337)', () => {
  const gate = parseChoicesGate(
    block('{ "title": "Which auth?", "options": [{ "id": "sessions", "label": "Sessions" }, { "id": "jwt", "label": "JWT", "detail": "stateless" }], "recommended": "sessions" }'),
  )
  assert.ok(gate)
  assert.equal(gate.title, 'Which auth?')
  assert.equal(gate.recommended, 'sessions')
  assert.deepEqual(gate.options, [
    { id: 'sessions', label: 'Sessions' },
    { id: 'jwt', label: 'JWT', detail: 'stateless' },
  ])
})

test('parseChoicesGate synthesizes ids and defaults a blank title (#337)', () => {
  const gate = parseChoicesGate(block('{ "options": [{ "label": "A" }, { "label": "B" }] }'))
  assert.ok(gate)
  assert.equal(gate.title, 'Which option?')
  assert.deepEqual(gate.options.map(o => o.id), ['opt:0', 'opt:1'])
  assert.equal(gate.recommended, undefined)
})

test('parseChoicesGate maps a recommended label to its option id (#337)', () => {
  const gate = parseChoicesGate(block('{ "title": "Pick", "options": [{ "label": "First" }, { "label": "Second" }], "recommended": "Second" }'))
  assert.ok(gate)
  assert.equal(gate.recommended, 'opt:1')
})

test('parseChoicesGate takes the last block when a turn has more than one (#337)', () => {
  const text = block('{ "options": [{ "label": "old" }] }') + '\n' + block('{ "title": "final", "options": [{ "label": "new" }] }')
  const gate = parseChoicesGate(text)
  assert.ok(gate)
  assert.equal(gate.title, 'final')
  assert.deepEqual(gate.options.map(o => o.label), ['new'])
})

test('parseChoicesGate ignores a malformed or empty block rather than throwing (#337)', () => {
  assert.equal(parseChoicesGate(block('{ not json')), undefined)
  assert.equal(parseChoicesGate(block('{ "options": [] }')), undefined)
  assert.equal(parseChoicesGate(block('{ "options": [{ "detail": "no label" }] }')), undefined)
  assert.equal(parseChoicesGate(block('{ "title": "x" }')), undefined) // no options array
})

test('parseMultiSelectGate parses a checklist and preserves default-checked entries (#339)', () => {
  const gate = parseMultiSelectGate(
    multiBlock('{ "title": "Which problems?", "options": [{ "label": "auth", "default": true }, { "label": "routing" }, { "label": "data", "detail": "rated 2/10", "default": true }] }'),
  )
  assert.ok(gate)
  assert.equal(gate.title, 'Which problems?')
  assert.deepEqual(gate.options, [
    { id: 'opt:0', label: 'auth', default: true },
    { id: 'opt:1', label: 'routing' },
    { id: 'opt:2', label: 'data', detail: 'rated 2/10', default: true },
  ])
})

test('parseMultiSelectGate returns undefined for no block / empty options (#339)', () => {
  assert.equal(parseMultiSelectGate('no block here'), undefined)
  assert.equal(parseMultiSelectGate(multiBlock('{ "options": [] }')), undefined)
})

test('parseConfirmationGate parses a plan approval with its file (#358)', () => {
  const gate = parseConfirmationGate(confirmBlock('{ "title": "Approve the plan?", "file": "PLAN_orders.agent.md" }'))
  assert.ok(gate)
  assert.equal(gate.title, 'Approve the plan?')
  assert.equal(gate.file, 'PLAN_orders.agent.md')
})

test('parseConfirmationGate defaults a blank title and omits a missing file (#358)', () => {
  const gate = parseConfirmationGate(confirmBlock('{}'))
  assert.ok(gate)
  assert.equal(gate.title, 'Approve this plan?')
  assert.equal(gate.file, undefined)
})

test('parseConfirmationGate ignores a malformed block rather than throwing (#358)', () => {
  assert.equal(parseConfirmationGate(confirmBlock('{ not json')), undefined)
  assert.equal(parseConfirmationGate(confirmBlock('"just a string"')), undefined)
  assert.equal(parseConfirmationGate('no block here'), undefined)
})

test('parseAwaitGate discriminates a confirmation, later block wins (#358)', () => {
  const c = parseAwaitGate(confirmBlock('{ "title": "Approve?", "file": "PLAN_x.agent.md" }'))
  assert.equal(c?.kind, 'confirm')
  const both = parseAwaitGate(block('{ "options": [{ "label": "x" }] }') + '\n' + confirmBlock('{ "title": "Approve?" }'))
  assert.equal(both?.kind, 'confirm')
  // A malformed later confirmation falls back to the earlier choices block.
  const broken = parseAwaitGate(block('{ "options": [{ "label": "x" }] }') + '\n' + confirmBlock('{ not json'))
  assert.equal(broken?.kind, 'choices')
})

test('isDeclinedConfirmation flags only a declined confirmation (#358)', () => {
  const confirm = parseAwaitGate(confirmBlock('{ "title": "Approve?" }'))
  assert.ok(confirm)
  assert.equal(isDeclinedConfirmation(confirm, 'Decline'), true)
  assert.equal(isDeclinedConfirmation(confirm, 'Approve'), false)
  const choices = parseAwaitGate(block('{ "options": [{ "label": "Decline" }] }'))
  assert.ok(choices)
  assert.equal(isDeclinedConfirmation(choices, 'Decline'), false)
})

test('parseAwaitGate discriminates choices vs multiselect, later block wins (#339)', () => {
  const c = parseAwaitGate(block('{ "options": [{ "label": "one" }] }'))
  assert.equal(c?.kind, 'choices')
  const m = parseAwaitGate(multiBlock('{ "options": [{ "label": "a", "default": true }] }'))
  assert.equal(m?.kind, 'multi')
  assert.equal(parseAwaitGate('the agent just finished'), undefined)
  // Both present: the one appearing later in the turn wins.
  const both = parseAwaitGate(block('{ "options": [{ "label": "x" }] }') + '\n' + multiBlock('{ "options": [{ "label": "y" }] }'))
  assert.equal(both?.kind, 'multi')
})

test('parseMarkdownViews returns [] when the turn has no show-markdown block (#441)', () => {
  assert.deepEqual(parseMarkdownViews('Built the app, nothing to show.'), [])
})

test('parseMarkdownViews parses a titled block, stripping the heading (#441)', () => {
  const views = parseMarkdownViews('Here is the plan.\n```show-markdown\n# Deployment plan\n## Steps\n- do X\n```')
  assert.deepEqual(views, [{ id: 'deployment-plan', title: 'Deployment plan', markdown: '## Steps\n- do X' }])
})

test('parseMarkdownViews falls back to Note when the block has no heading (#441)', () => {
  const views = parseMarkdownViews('```show-markdown\njust some body text\n```')
  assert.deepEqual(views, [{ id: 'note', title: 'Note', markdown: 'just some body text' }])
})

test('parseMarkdownViews collects several blocks and keeps the later of a repeated title (#441)', () => {
  const views = parseMarkdownViews(
    '```show-markdown\n# Plan\nfirst\n```\ntext\n```show-markdown\n# Summary\ndone\n```\n```show-markdown\n# Plan\nupdated\n```',
  )
  assert.deepEqual(views, [
    { id: 'plan', title: 'Plan', markdown: 'updated' },
    { id: 'summary', title: 'Summary', markdown: 'done' },
  ])
})

test('parseMarkdownViews skips a blank block (#441)', () => {
  assert.deepEqual(parseMarkdownViews('```show-markdown\n# Empty\n```'), [])
})

test('parseSessionName returns undefined when the turn set no session name (#326)', () => {
  assert.equal(parseSessionName('Working on the branch, no signal here.'), undefined)
})

test('parseSessionName reads + slugifies the name from a set-session-name block (#326)', () => {
  assert.equal(parseSessionName('```set-session-name\nadd-comments\n```'), 'add-comments')
  // Free-form text is slugified to the [a-z0-9-] branch shape.
  assert.equal(parseSessionName('done.\n```set-session-name\nAdd Comments Feature!\n```'), 'add-comments-feature')
  // The first non-empty line is the name.
  assert.equal(parseSessionName('```set-session-name\n\n  my-slug  \nignored\n```'), 'my-slug')
})

test('parseSessionName keeps the later block when the agent renames mid-turn (#326)', () => {
  assert.equal(parseSessionName('```set-session-name\nfirst\n```\nthen\n```set-session-name\nsecond\n```'), 'second')
})

test('parseReadyForMerge is true only when a ready-for-merge block is present (#326)', () => {
  assert.equal(parseReadyForMerge('Still building the feature.'), false)
  assert.equal(parseReadyForMerge('All done.\n```ready-for-merge\n```'), true)
  assert.equal(parseReadyForMerge('```ready-for-merge```'), true) // empty, no inner newline
})
