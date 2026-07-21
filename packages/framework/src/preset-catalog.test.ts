import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { presets, LAUNCHER_PRESETS } from './preset-catalog.js'
import { presetFilePath } from './preset-registry.js'

// One test file for the whole catalog, matching the one module that now defines it. What used to
// be thirteen near-identical files is here two shared contracts plus the per-preset prompt content
// that actually differs.

/** The presets that take a `what`, with the phrase each renders it into. */
const PARAMETERIZED = [
  { preset: presets.maintainability, defaultOut: /^Refactor entire codebase to make it/, custom: 'the queue package', customOut: /^Refactor the queue package to make it/ },
  { preset: presets.readability, defaultOut: /^Refactor entire codebase to make it/, custom: 'the dashboard package', customOut: /^Refactor the dashboard package to make it/ },
  { preset: presets.research, defaultOut: /problem variability" of entire codebase/, custom: 'the auth flow', customOut: /problem variability" of the auth flow/ },
  { preset: presets.securityAudit, defaultOut: /^Security audit entire codebase/, custom: 'the auth package', customOut: /^Security audit the auth package/ },
  { preset: presets.ux, defaultOut: /^Thoroughly review UX of entire codebase/, custom: 'the settings page', customOut: /^Thoroughly review UX of the settings page/ },
  { preset: presets.maintenance, defaultOut: /^Analyze entire codebase and/, custom: 'the auth package', customOut: /^Analyze the auth package and/ },
] as const

/** The presets that scope themselves, so there is no blank for a user to fill. */
const PARAMLESS = [
  presets.marketResearch,
  presets.importTickets,
  presets.quickWins,
  presets.spikeAndPlan,
  presets.suggestNewTickets,
  presets.suggestTicketsToWorkOn,
  presets.drainQueue,
  presets.triageQuick,
  presets.triageConsensual,
] as const

test('every preset keeps its exact run-kind name', () => {
  // Pinned, not just checked for uniqueness: the name is the id the launcher keys on and the stem
  // `presetFilePath` resolves, so a rename silently breaks the button and the queued TODO's path.
  assert.deepEqual(
    Object.values(presets).map(p => p.name).sort(),
    [
      'drain-queue', 'import-tickets', 'maintainability', 'maintenance', 'market-research',
      'quick-wins', 'readability', 'research', 'security-audit', 'spike-and-plan',
      'suggest-new-tickets', 'suggest-tickets-to-work-on', 'triage-consensual', 'triage-quick',
      'ux',
    ],
  )
})

test('the launcher offers every preset except the daemon-only one', () => {
  const offered = LAUNCHER_PRESETS.map(p => p.name)
  assert.equal(offered.includes('drain-queue'), false, 'drain-queue is fired by the daemon only')
  assert.equal(offered.length, Object.keys(presets).length - 1)
  for (const preset of LAUNCHER_PRESETS) assert.ok(preset.label, `${preset.name} needs a label`)
})

test('a parameterized preset takes one `what`, falls back to the default, and leaves no placeholder', () => {
  for (const { preset, defaultOut, custom, customOut } of PARAMETERIZED) {
    assert.deepEqual(preset.params.map(p => p.name), ['what'], preset.name)
    assert.match(preset.template, /\$\{\{ tf\.params\.what \}\}/, preset.name)
    assert.match(preset.render(), defaultOut, preset.name)
    // A blank falls back to the default rather than erasing the target.
    assert.match(preset.render('   '), defaultOut, preset.name)
    assert.match(preset.render(custom), customOut, preset.name)
    assert.equal(preset.render(custom).includes('${{'), false, preset.name)
  }
})

test('a paramless preset renders its template verbatim, with nothing left to fill', () => {
  for (const preset of PARAMLESS) {
    assert.deepEqual(preset.params, [], preset.name)
    assert.equal(preset.render(), preset.template, preset.name)
    assert.equal(preset.render().includes('${{'), false, preset.name)
  }
})

test('the quality presets carry their #326 instructions', () => {
  assert.match(presets.maintainability.template, /as maintainable as possible/)
  assert.match(presets.maintainability.template, /maintainability red flags/)

  assert.match(presets.readability.template, /easy as possible for humans to read/)
  assert.match(presets.readability.template, /Rate the \*seams\*/)
  assert.match(presets.readability.template, /Altitude pass/)
  assert.match(presets.readability.template, /Separate commit for each refactor/)
  assert.match(presets.readability.template, /<FUNCTION>/)
  assert.match(presets.readability.template, /^FUNCTION: /m)
  assert.match(presets.readability.render('the dashboard package'), /<FUNCTION>/)

  assert.match(presets.securityAudit.template, /^Security audit/)
  assert.match(presets.securityAudit.template, /exhaustive \(100% coverage\)/)
  assert.match(presets.securityAudit.template, /verdict/)
  assert.match(presets.securityAudit.template, /each security issue in a separate commit/)

  assert.match(presets.ux.template, /^Thoroughly review UX/)
  assert.match(presets.ux.template, /usability perspective/)
  assert.match(presets.ux.template, /showChoices\(\)/)
  assert.match(presets.ux.template, /<AWAIT>/)
  assert.match(presets.ux.template, /Work on all accepted proposals/)
})

test('Research gates on a multi-select and writes its own review/TODO files (#331)', () => {
  assert.match(presets.research.template, /problem variability/)
  assert.match(presets.research.template, /showMultiSelect\(\)/)
  assert.match(presets.research.template, /<AWAIT>/)
  assert.match(presets.research.template, /<REVIEW_FILE>/)
  assert.match(presets.research.template, /<TODO_FILE>/)
})

test('the Maintenance template queues work rather than doing it (#881)', () => {
  assert.match(presets.maintenance.template, /look for opportunities to refactor code/)
  assert.match(presets.maintenance.template, /TODO_AGENTS\.md \(usually as low priority\)/)
  assert.match(presets.maintenance.template, /<CODEBASE_SUBSET>/)
})

test('Maintenance points at the other presets by their real file paths (#881)', () => {
  const out = presets.maintenance.render()
  assert.ok(out.includes(presetFilePath('maintainability')), 'expected the maintainability path')
  assert.ok(out.includes(presetFilePath('security_audit')), 'expected the security_audit path')
  // No raw placeholder survives a render — the whole point of flattening the nested fragment.
  assert.equal(out.includes('${{'), false)
})

test('Maintenance queues readability only under technical_control (#881)', () => {
  const off = presets.maintenance.render(undefined, { settings: { technical_control: false } })
  assert.equal(off.includes(presetFilePath('readability')), false)
  // Absent settings behave like off, and must not throw.
  assert.equal(presets.maintenance.render().includes(presetFilePath('readability')), false)

  const on = presets.maintenance.render(undefined, { settings: { technical_control: true } })
  assert.ok(on.includes(presetFilePath('readability')), 'expected the readability path')
  assert.equal(on.includes('${{'), false)
})

test('a parameterized preset targets the launching session when there is one (#874)', () => {
  assert.match(presets.maintenance.render(undefined, { session_name: 'fix-login' }), /^Analyze fix-login and/)
})

test('Market research researches, then queues the follow-up (#694)', () => {
  const prompt = presets.marketResearch.render()
  assert.match(prompt, /thorough market research/)
  assert.match(prompt, /MARKET_RESEARCH\.md/)
  assert.match(prompt, /TODO_AGENTS\.md entry/)
  assert.match(prompt, /suggest new tickets/)
  // It defines <SESSION_NAME> itself: the session does not exist yet when a preset renders.
  assert.match(prompt, /<SESSION_NAME>/)
  assert.match(prompt, /^SESSION_NAME: /m)
})

test('Suggest new tickets is the one line the dashboard prefills (#683)', () => {
  assert.equal(presets.suggestNewTickets.template, 'Suggest new tickets')
  assert.equal(presets.suggestNewTickets.render(), 'Suggest new tickets')
})

test('Suggest tickets to work on gates on a human, unlike the triage pair (#698)', () => {
  const prompt = presets.suggestTicketsToWorkOn.render()
  assert.match(prompt, /Look at all tickets and pick tickets to work on next/)
  assert.match(prompt, /showMultiSelect\(\)/)
  assert.match(prompt, /<AWAIT>/)
  assert.match(prompt, /Add approved tickets to `TODO_AGENTS\.md`/)
  assert.match(prompt, /set its default to `true`, otherwise `false`/)
  assert.doesNotMatch(prompt, /showChoices\(\)/)
  assert.match(prompt, /^AWAIT: Stop, await user answer before resuming$/m)
  assert.doesNotMatch(prompt, /TODO_<SESSION_NAME>|\.agent\.md/)
})

test('the triage pair splits on cost and both append to the queue (#891/#892)', () => {
  assert.match(presets.triageQuick.template, /Only pick tickets that are quick-wins and consensual/)
  assert.match(presets.triageQuick.template, /Add tickets to TODO_AGENTS\.md/)
  assert.match(presets.triageConsensual.template, /Only pick tickets that are significant \(no quick-wins\) and consensual/)
  assert.match(presets.triageConsensual.template, /Add tickets to TODO_AGENTS\.md/)
})

test('each triage preset pins its own session name and aborts on a taken branch (#891/#892)', () => {
  // The collision guard is what makes these safe to fire on a schedule: a triage already in
  // flight owns the branch, so the next firing must do nothing rather than triage twice.
  for (const preset of [presets.triageQuick, presets.triageConsensual]) {
    const out = preset.render()
    assert.match(out, new RegExp(`Always set <SESSION_NAME> to ${preset.name}`))
    assert.match(out, /If branch the-framework\/<SESSION_NAME> already exists, abort and do nothing/)
  }
  // Distinct session names, or the two would collide with each other rather than with their own
  // in-flight run.
  assert.notEqual(presets.triageQuick.name, presets.triageConsensual.name)
})

test('neither ungated triage preset waits on a human (#891/#892 vs #698)', () => {
  // They run unattended from the rotation, so an <AWAIT> would park the run against nobody.
  // The gated sibling is the one that legitimately has it.
  for (const out of [presets.triageQuick.render(), presets.triageConsensual.render()]) {
    assert.equal(out.includes('<AWAIT>'), false)
    assert.equal(out.includes('<SHOW_CHOICES>'), false)
    assert.equal(out.includes('showMultiSelect'), false)
  }
  assert.ok(presets.suggestTicketsToWorkOn.template.includes('<AWAIT>'), 'the gated preset still awaits')
})

test('one preset, and only one, always opens a session of its own (#959)', () => {
  // The flag is a property of the work, not of the surface that fires it, so it is pinned here
  // rather than in the dashboard: the import reads GitHub and writes `tickets/`, which has nothing
  // to do with whatever session the user happened to be reading when they clicked it.
  const marked = Object.values(presets).filter(p => p.newSession).map(p => p.name)
  assert.deepEqual(marked, ['import-tickets'])
  assert.equal(presets.importTickets.template, 'Import tickets from GitHub')
  assert.equal(presets.importTickets.render(), 'Import tickets from GitHub')
  assert.equal(LAUNCHER_PRESETS.includes(presets.importTickets), true)
})

