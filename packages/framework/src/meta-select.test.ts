import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DomainPreset } from '@gemstack/ai-autopilot'
import { FakeDriver } from './driver/index.js'
import {
  META_SELECT_MODES,
  metaSelect,
  metaSelectPrompt,
  parseMetaSelection,
  presetCatalog,
  type PresetCatalogEntry,
} from './meta-select.js'

/** Two tiny presets whose loops declare distinct build kinds, for catalog + validation tests. */
function fakePresets(): DomainPreset[] {
  const loop = (on: string[]) => ({ on, run: [] as string[] }) as DomainPreset['loops'][number]
  return [
    {
      name: 'web-development',
      title: 'Web Development',
      description: 'Building web apps.',
      defaultEvent: 'major-change',
      loops: [loop(['major-change']), loop(['bug-fix'])],
      prompts: [],
      skills: [],
    },
    {
      name: 'data-science',
      title: 'Data Science',
      description: 'Notebooks and models.',
      loops: [loop(['major-change'])],
      prompts: [],
      skills: [],
    },
  ]
}

const CATALOG = (): PresetCatalogEntry[] => presetCatalog(fakePresets())

test('presetCatalog derives name/title/description + deduped event kinds + defaultEvent', () => {
  assert.deepEqual(presetCatalog(fakePresets()), [
    {
      name: 'web-development',
      title: 'Web Development',
      description: 'Building web apps.',
      eventKinds: ['major-change', 'bug-fix'],
      defaultEvent: 'major-change',
    },
    {
      name: 'data-science',
      title: 'Data Science',
      description: 'Notebooks and models.',
      eventKinds: ['major-change'],
    },
  ])
})

test('parseMetaSelection accepts a valid preset + modes + event + why', () => {
  const text = '```json\n{ "preset": "web-development", "modes": ["technical"], "event": "bug-fix", "why": "fixing a defect" }\n```'
  assert.deepEqual(parseMetaSelection(text, CATALOG()), {
    preset: 'web-development',
    modes: ['technical'],
    buildEvent: 'bug-fix',
    why: 'fixing a defect',
  })
})

test('parseMetaSelection drops an unknown preset (plain flow), keeping only why', () => {
  const text = '{ "preset": "biology", "modes": ["technical"], "event": "bug-fix", "why": "no fit" }'
  assert.deepEqual(parseMetaSelection(text, CATALOG()), { modes: [], why: 'no fit' })
})

test('parseMetaSelection filters unknown modes and drops an event the preset has no loop for', () => {
  // data-science only has a major-change loop; "bug-fix" and mode "wizard" are not valid there.
  const text = '{ "preset": "data-science", "modes": ["wizard", "autopilot"], "event": "bug-fix" }'
  assert.deepEqual(parseMetaSelection(text, CATALOG()), { preset: 'data-science', modes: ['autopilot'] })
})

test('parseMetaSelection returns the plain-flow selection for junk text', () => {
  assert.deepEqual(parseMetaSelection('I could not decide.', CATALOG()), { modes: [] })
})

test('parseMetaSelection knows exactly the two shipped modes', () => {
  assert.deepEqual([...META_SELECT_MODES], ['autopilot', 'technical'])
})

test('metaSelectPrompt names the task, the workspace, and every preset', () => {
  const prompt = metaSelectPrompt('add a login page', CATALOG(), 'an existing project (dependencies: react)')
  assert.match(prompt, /add a login page/)
  assert.match(prompt, /an existing project \(dependencies: react\)/)
  assert.match(prompt, /web-development/)
  assert.match(prompt, /data-science/)
})

test('metaSelect routes one prompt through the driver and parses the reply', async () => {
  const driver = new FakeDriver({
    turns: [{ text: '```json\n{ "preset": "web-development", "modes": ["technical"], "event": "major-change", "why": "a web feature" }\n```' }],
  })
  const session = await driver.start({ cwd: '/tmp/x', system: 'router' })
  const selection = await metaSelect(session, {
    intent: 'add a settings page',
    catalog: CATALOG(),
    workspace: 'an existing project',
  })
  await session.dispose()
  assert.deepEqual(selection, {
    preset: 'web-development',
    modes: ['technical'],
    buildEvent: 'major-change',
    why: 'a web feature',
  })
})
