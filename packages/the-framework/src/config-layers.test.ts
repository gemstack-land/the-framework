import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  describeResolvedConfig,
  fileConfigLayer,
  resolveConfigKey,
  resolveRunConfig,
  resolvedModes,
  RUN_CONFIG_DEFAULTS,
  type ConfigLayer,
} from './config-layers.js'

// The #800 chain, nearest first.
const chain = (run = {}, project = {}, repo = {}, global = {}): ConfigLayer[] => [
  { name: 'run', values: run },
  { name: 'project', values: project },
  { name: 'the-framework.yml', values: repo },
  { name: 'global', values: global },
]

test('resolveConfigKey takes the nearest layer that set the key (#841)', () => {
  assert.deepEqual(resolveConfigKey(chain({ autopilot: false }, { autopilot: true }), 'autopilot'), {
    value: false,
    from: 'run',
  })
  assert.deepEqual(resolveConfigKey(chain({}, { autopilot: true }), 'autopilot'), { value: true, from: 'project' })
  assert.deepEqual(resolveConfigKey(chain({}, {}, {}, { autopilot: false }), 'autopilot'), {
    value: false,
    from: 'global',
  })
})

test('resolveConfigKey ignores layers that left the key unset (#841)', () => {
  assert.equal(resolveConfigKey(chain(), 'autopilot'), undefined)
  // An unset key in a nearer layer does not shadow a farther one that set it.
  assert.deepEqual(resolveConfigKey(chain({ technical: true }, {}, { autopilot: true }), 'autopilot'), {
    value: true,
    from: 'the-framework.yml',
  })
})

test('resolveRunConfig: each layer can win, and each can be absent (#841)', () => {
  for (const layer of ['run', 'project', 'the-framework.yml', 'global']) {
    const layers = chain().map(l => (l.name === layer ? { ...l, values: { autopilot: true, preset: layer } } : l))
    const resolved = resolveRunConfig(layers)
    assert.equal(resolved.autopilot, true, `${layer} should win autopilot`)
    assert.equal(resolved.presetName, layer)
    assert.equal(resolved.sources.autopilot, layer)
  }
  // Every layer absent: the defaults hold and nothing claims a source.
  const bare = resolveRunConfig(chain())
  assert.equal(bare.autopilot, RUN_CONFIG_DEFAULTS.autopilot)
  assert.equal(bare.technical, RUN_CONFIG_DEFAULTS.technical)
  assert.equal(bare.antiLazyPill, RUN_CONFIG_DEFAULTS.antiLazyPill)
  assert.equal(bare.transparent, RUN_CONFIG_DEFAULTS.transparent)
  assert.equal(bare.presetName, undefined)
  assert.equal(bare.buildEvent, undefined)
  assert.deepEqual(bare.sources, {})
  // No layers at all resolves the same way as layers that set nothing.
  assert.deepEqual(resolveRunConfig([]), bare)
})

test('resolveRunConfig: a nearer false beats a farther true (#841)', () => {
  const resolved = resolveRunConfig(chain({}, { transparent: false }, { transparent: true }))
  assert.equal(resolved.transparent, false)
  assert.equal(resolved.sources.transparent, 'project')
})

test('fileConfigLayer carries only the keys the-framework.yml set', () => {
  assert.deepEqual(fileConfigLayer({}), { name: 'the-framework.yml', values: {} })
  assert.deepEqual(fileConfigLayer({ autopilot: false, preset: 'software-development' }).values, {
    autopilot: false,
    preset: 'software-development',
  })
  // `event` is the file's name for the build event key.
  assert.deepEqual(fileConfigLayer({ event: 'bug-fix' }).values, { event: 'bug-fix' })
  assert.equal(fileConfigLayer({}, 'other.yml').name, 'other.yml')
})

test('resolvedModes lists the active Open Loop modes in a stable order', () => {
  assert.deepEqual(resolvedModes({ autopilot: false, technical: false }), [])
  assert.deepEqual(resolvedModes({ autopilot: true, technical: false }), ['autopilot'])
  assert.deepEqual(resolvedModes({ autopilot: true, technical: true }), ['autopilot', 'technical'])
})

test('describeResolvedConfig narrates which layer won each key (#841)', () => {
  assert.equal(describeResolvedConfig(resolveRunConfig(chain())), '')
  assert.equal(
    describeResolvedConfig(resolveRunConfig(chain({ autopilot: false }, {}, { autopilot: true, preset: 'software-development' }))),
    'preset=software-development (the-framework.yml), autopilot=off (run)',
  )
  assert.equal(
    describeResolvedConfig(resolveRunConfig(chain({}, {}, { event: 'bug-fix', transparent: true }))),
    'transparent=on (the-framework.yml), event=bug-fix (the-framework.yml)',
  )
})
