import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { definePersona } from '../personas/define.js'
import { dataModeler, uiIntentDesigner } from '../personas/library.js'
import { composePersonas, composeSkills, skillInstructions } from './compose.js'
import { defineFrameworkExtension, defineSkill, ExtensionError } from './define.js'
import {
  builtinExtensionNames,
  builtinExtensions,
  frameworkAuth,
  frameworkData,
  neutralPersonas,
  vikeSkill,
} from './library.js'
import { extensionPackageNames, isFrameworkExtension, loadExtensionsFromModules } from './load.js'
import { matchSignals, selectActive } from './match.js'
import { ExtensionRegistry, SkillRegistry } from './registry.js'

const persona = (name: string) => definePersona({ name, role: name, systemPrompt: `I am ${name}.` })

test('defineFrameworkExtension validates and freezes', () => {
  const ext = defineFrameworkExtension({ name: 'framework-x', capability: 'x', personas: [persona('p')] })
  assert.equal(ext.name, 'framework-x')
  assert.equal(ext.capability, 'x')
  assert.ok(Object.isFrozen(ext))
  assert.deepEqual(ext.skills, [])
  assert.throws(() => defineFrameworkExtension({ name: 'Bad Name', capability: 'x' }), ExtensionError)
  assert.throws(() => defineFrameworkExtension({ name: 'ok', capability: '' }), ExtensionError)
})

test('defineSkill validates the required fields', () => {
  const s = defineSkill({ name: 'vike', title: 'Vike', description: 'd', url: 'https://x/llms.txt' })
  assert.equal(s.url, 'https://x/llms.txt')
  assert.throws(() => defineSkill({ name: 'vike', title: 'Vike', description: 'd', url: '' }), ExtensionError)
  assert.throws(() => defineSkill({ name: 'Vike', title: 'Vike', description: 'd', url: 'u' }), ExtensionError)
})

test('matchSignals scores deps over files; selectActive unions signal-match and opt-in', () => {
  const ext = defineFrameworkExtension({ name: 'framework-auth', capability: 'auth', signals: { dependencies: ['vike-auth'] } })
  assert.equal(matchSignals(ext.signals, { dependencies: ['vike-auth'] }).score, 2)
  assert.equal(matchSignals(ext.signals, { dependencies: ['other'] }).score, 0)

  const units = [ext]
  // Not installed, not opted-in -> inactive.
  assert.deepEqual(selectActive(units, { dependencies: [] }), [])
  // Installed -> active by signal.
  assert.deepEqual(selectActive(units, { dependencies: ['vike-auth'] }), [ext])
  // Opted in by name even without the dep -> active.
  assert.deepEqual(selectActive(units, { dependencies: [] }, ['framework-auth']), [ext])
})

test('ExtensionRegistry.match honors signals and include; addAll registers extras', () => {
  const reg = new ExtensionRegistry()
  assert.deepEqual(reg.match({ dependencies: [] }), []) // nothing installed, no opt-in
  assert.deepEqual(
    reg.match({ dependencies: ['vike-auth'] }).map(e => e.name),
    ['framework-auth'],
  )
  // Opt every built-in in by name (the --compose-extensions set).
  assert.deepEqual(
    reg.match({ dependencies: [] }, { include: builtinExtensionNames }).map(e => e.name),
    [...builtinExtensionNames],
  )
  // A discovered third-party extension registers and auto-activates by its signal.
  const third = defineFrameworkExtension({ name: 'framework-sentry', capability: 'tracking', signals: { dependencies: ['@sentry/node'] } })
  reg.addAll([third])
  assert.ok(reg.match({ dependencies: ['@sentry/node'] }).some(e => e.name === 'framework-sentry'))
})

test('SkillRegistry activates the Vike skill when Vike is detected', () => {
  const reg = new SkillRegistry()
  assert.deepEqual(reg.match({ dependencies: ['vike-react'] }).map(s => s.name), ['vike'])
  assert.deepEqual(reg.match({ dependencies: ['react'] }), [])
  assert.deepEqual(reg.match({ files: ['pages/+config.js'] }).map(s => s.name), ['vike'])
})

test('composePersonas: extensions supersede the neutral default of their capability', () => {
  const base = [persona('page-builder')]
  // No extensions: base + both neutral defaults.
  const dflt = composePersonas({ base, extensions: [], neutral: neutralPersonas })
  assert.deepEqual(dflt.map(p => p.name), ['page-builder', dataModeler.name, uiIntentDesigner.name])

  // framework-data (capability 'data') drops the default data modeler; ui stays.
  const withData = composePersonas({ base, extensions: [frameworkData], neutral: neutralPersonas })
  const names = withData.map(p => p.name)
  assert.ok(names.includes('vike-data-modeler'))
  assert.ok(!names.includes(dataModeler.name)) // superseded
  assert.ok(names.includes(uiIntentDesigner.name)) // no extension owns 'ui'
})

test('composeSkills unions matched skills with active extensions own skills, deduped by name', () => {
  const guide = defineSkill({ name: 'hello-guide', title: 'Hello', description: 'd', url: 'https://x/llms.txt' })
  const ext = defineFrameworkExtension({ name: 'framework-hello', capability: 'greeting', skills: [guide, vikeSkill] })
  const composed = composeSkills({ matched: [vikeSkill], extensions: [ext] })
  // vikeSkill (matched) is not duplicated by the extension re-declaring it; hello-guide is added.
  assert.deepEqual(composed.map(s => s.name), ['vike', 'hello-guide'])
})

test('skillInstructions renders the doc pointer', () => {
  const text = skillInstructions(vikeSkill)
  assert.match(text, /Vike/)
  assert.match(text, /https:\/\/vike\.dev\/llms\.txt/)
})

test('the built-in auth extension composes vike-auth and the data extension owns data', () => {
  assert.equal(frameworkAuth.capability, 'auth')
  assert.equal(frameworkAuth.personas[0]!.name, 'vike-auth-composer')
  assert.equal(frameworkData.capability, 'data')
  assert.deepEqual([...builtinExtensionNames], builtinExtensions().map(e => e.name))
})

test('extensionPackageNames filters to the framework-* convention and excludes the core', () => {
  const names = extensionPackageNames(
    ['react', 'framework-auth', '@gemstack/framework', '@acme/framework-sentry', 'vike', 'framework-auth'],
    { exclude: ['@gemstack/framework'] },
  )
  assert.deepEqual(names, ['@acme/framework-sentry', 'framework-auth']) // deduped + sorted, core excluded
})

test('isFrameworkExtension duck-types a loaded export', () => {
  assert.ok(isFrameworkExtension(frameworkAuth))
  assert.ok(!isFrameworkExtension({ name: 'x' }))
  assert.ok(!isFrameworkExtension(null))
})

test('loadExtensionsFromModules loads good exports and reports bad ones without throwing', async () => {
  const good = defineFrameworkExtension({ name: 'framework-good', capability: 'g' })
  const modules: Record<string, unknown> = {
    'framework-good': { default: good },
    'framework-named': { extension: defineFrameworkExtension({ name: 'framework-named', capability: 'n' }) },
    'framework-empty': { something: 1 },
    'framework-throws': undefined, // triggers the throw branch below
  }
  const load = async (name: string) => {
    if (name === 'framework-throws') throw new Error('boom')
    return modules[name]
  }
  const { loaded, failed } = await loadExtensionsFromModules(
    ['framework-good', 'framework-named', 'framework-empty', 'framework-throws'],
    load,
  )
  assert.deepEqual(loaded.map(l => l.package), ['framework-good', 'framework-named'])
  assert.deepEqual(
    failed.map(f => f.package),
    ['framework-empty', 'framework-throws'],
  )
  assert.match(failed.find(f => f.package === 'framework-throws')!.error, /boom/)
})
