import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFrameworkConfig, parseFrameworkConfig } from './config.js'

test('parseFrameworkConfig reads preset + mode booleans + event', () => {
  assert.deepEqual(
    parseFrameworkConfig('preset: software-development\nautopilot: true\ntechnical: false\nevent: bug-fix\n'),
    {
      preset: 'software-development',
      autopilot: true,
      technical: false,
      event: 'bug-fix',
    },
  )
})

test('parseFrameworkConfig reads the antiLazyPill toggle', () => {
  assert.deepEqual(parseFrameworkConfig('antiLazyPill: false\n'), { antiLazyPill: false })
  assert.throws(() => parseFrameworkConfig('antiLazyPill: nope\n'), /"antiLazyPill" must be a boolean/)
})

test('parseFrameworkConfig reads the transparent toggle (#625)', () => {
  assert.deepEqual(parseFrameworkConfig('transparent: true\n'), { transparent: true })
  assert.throws(() => parseFrameworkConfig('transparent: nope\n'), /"transparent" must be a boolean/)
})

test('parseFrameworkConfig treats an empty document as {}', () => {
  assert.deepEqual(parseFrameworkConfig(''), {})
  assert.deepEqual(parseFrameworkConfig('# just a comment\n'), {})
})

test('parseFrameworkConfig rejects a non-map document and mistyped fields', () => {
  assert.throws(() => parseFrameworkConfig('- a\n- b\n'), /must be a YAML map/)
  assert.throws(() => parseFrameworkConfig('preset: 3\n'), /"preset" must be a string/)
  assert.throws(() => parseFrameworkConfig('event: 3\n'), /"event" must be a string/)
  assert.throws(() => parseFrameworkConfig('autopilot: yep\n'), /"autopilot" must be a boolean/)
})

test('loadFrameworkConfig reads the-framework.yml from a directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'framework-cfg-'))
  try {
    await writeFile(join(dir, 'the-framework.yml'), 'preset: software-development\nautopilot: true\n')
    assert.deepEqual(await loadFrameworkConfig(dir), { preset: 'software-development', autopilot: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadFrameworkConfig yields {} when no config file is present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'framework-cfg-empty-'))
  try {
    assert.deepEqual(await loadFrameworkConfig(dir), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadFrameworkConfig warns and returns {} on a malformed file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'framework-cfg-bad-'))
  try {
    await writeFile(join(dir, 'the-framework.yml'), 'preset: 3\n')
    const warnings: string[] = []
    assert.deepEqual(await loadFrameworkConfig(dir, m => warnings.push(m)), {})
    assert.ok(warnings.some(w => /ignoring the-framework\.yml/.test(w)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
