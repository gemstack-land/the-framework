import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  addProject,
  listProjects,
  projectId,
  readPreferences,
  readProjectPreferences,
  readRegistry,
  resolvePreferences,
  registryPreferencesStore,
  registryPath,
  removeProject,
  writePreferences,
  writeProjectPreferences,
  REGISTRY_FILE,
  type Preferences,
  type ProjectRecord,
  type RegistryFs,
} from './registry.js'

/** An in-memory {@link RegistryFs} so the registry logic is tested without touching disk. */
function memFs(seed: Record<string, string> = {}): RegistryFs & { files: Map<string, string>; dirs: string[] } {
  const files = new Map<string, string>(Object.entries(seed))
  const dirs: string[] = []
  return {
    files,
    dirs,
    async read(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      files.set(path, contents)
    },
    async mkdir(path) {
      dirs.push(path) // no-op: the memory fs has no directories
    },
  }
}

const ENV = { HOME: '/home/u' }
const FILE = registryPath(ENV)

const APP_A: ProjectRecord = {
  id: projectId('/repos/app-a'),
  path: '/repos/app-a',
  addedAt: '2026-07-10T09:00:00.000Z',
}

const APP_B: ProjectRecord = {
  id: projectId('/repos/app-b'),
  path: '/repos/app-b',
  addedAt: '2026-07-10T10:00:00.000Z',
}

test('registryPath prefers XDG_CONFIG_HOME over HOME', () => {
  assert.equal(registryPath({ XDG_CONFIG_HOME: '/cfg' }), join('/cfg', REGISTRY_FILE))
  assert.equal(registryPath({ XDG_CONFIG_HOME: '/cfg', HOME: '/home/u' }), join('/cfg', REGISTRY_FILE))
})

test('registryPath falls back to a single dotfile under HOME (empty XDG counts as unset)', () => {
  assert.equal(registryPath(ENV), join('/home/u', '.' + REGISTRY_FILE))
  assert.equal(registryPath({ XDG_CONFIG_HOME: '', HOME: '/home/u' }), join('/home/u', '.' + REGISTRY_FILE))
})

test('projectId is deterministic and distinct per path', () => {
  assert.equal(projectId('/repos/app-a'), projectId('/repos/app-a'))
  assert.notEqual(projectId('/repos/app-a'), projectId('/repos/app-b'))
  assert.notEqual(projectId('/repos/app-a'), projectId('/other/app-a')) // same basename, different path
})

test('projectId is URL-safe, even for a messy basename', () => {
  for (const path of ['/repos/app-a', '/repos/My App (v2)!', '/repos/ÜMLAUT.dir']) {
    assert.match(projectId(path), /^[a-z0-9-]+$/)
  }
})

test('listProjects on a missing file is []', async () => {
  assert.deepEqual(await listProjects(memFs(), ENV), [])
})

test('listProjects on an empty / malformed / non-array file is []', async () => {
  for (const raw of ['', 'not json', '{"id":"x"}', '42']) {
    assert.deepEqual(await listProjects(memFs({ [FILE]: raw }), ENV), [])
  }
})

test('listProjects round-trips a well-formed file and drops malformed records', async () => {
  const raw = JSON.stringify([APP_A, { id: 'no-path' }, 'nope', APP_B])
  assert.deepEqual(await listProjects(memFs({ [FILE]: raw }), ENV), [APP_A, APP_B])
})

test('listProjects dedupes by resolved path, first wins', async () => {
  const dupe = { ...APP_B, path: '/repos/app-a/', addedAt: '2026-07-10T11:00:00.000Z' }
  const raw = JSON.stringify([APP_A, dupe, APP_B])
  assert.deepEqual(await listProjects(memFs({ [FILE]: raw }), ENV), [APP_A, APP_B])
})

test('addProject appends a record and writes pretty JSON that parses back', async () => {
  const fs = memFs()
  const record = await addProject('/repos/app-a', APP_A.addedAt, fs, ENV)
  assert.deepEqual(record, APP_A)
  assert.deepEqual(fs.dirs, ['/home/u']) // the single dotfile's parent is $HOME itself
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [APP_A], preferences: {} })

  await addProject('/repos/app-b', APP_B.addedAt, fs, ENV)
  assert.deepEqual(await listProjects(fs, ENV), [APP_A, APP_B])
})

test('addProject is idempotent by resolved path and keeps the original addedAt', async () => {
  const fs = memFs()
  await addProject('/repos/app-a', APP_A.addedAt, fs, ENV)
  for (const variant of ['/repos/app-a', '/repos/app-a/', '/repos/other/../app-a']) {
    const again = await addProject(variant, '2027-01-01T00:00:00.000Z', fs, ENV)
    assert.deepEqual(again, APP_A) // existing record, addedAt untouched
  }
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [APP_A], preferences: {} })
})

test('addProject normalizes the stored path to an absolute one', async () => {
  const fs = memFs()
  const record = await addProject('/repos/app-a/', APP_A.addedAt, fs, ENV)
  assert.equal(record.path, '/repos/app-a')
})

test('removeProject drops the matching record and returns true', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A, APP_B]) })
  assert.equal(await removeProject(APP_A.id, fs, ENV), true)
  assert.deepEqual(await listProjects(fs, ENV), [APP_B])
})

test('removeProject on an unknown id is false and does not write', async () => {
  const raw = JSON.stringify([APP_A])
  const fs = memFs({ [FILE]: raw })
  assert.equal(await removeProject('nope-123', fs, ENV), false)
  assert.equal(fs.files.get(FILE), raw) // untouched
})

test('removeProject on an empty / missing registry is false', async () => {
  assert.equal(await removeProject(APP_A.id, memFs(), ENV), false)
  assert.equal(await removeProject(APP_A.id, memFs({ [FILE]: '[]' }), ENV), false)
})

// Preferences (#410): stored in the same file next to the project list.

test('readRegistry reads a legacy bare-array file as { projects, preferences: {} }', async () => {
  const raw = JSON.stringify([APP_A, APP_B])
  assert.deepEqual(await readRegistry(memFs({ [FILE]: raw }), ENV), {
    projects: [APP_A, APP_B],
    preferences: {},
    projectPreferences: {},
  })
})

test('readRegistry reads the object form with preferences and drops unknown/non-boolean fields', async () => {
  const raw = JSON.stringify({
    projects: [APP_A],
    preferences: { autopilot: false, eco: true, ecoPlanning: 'yes', bogus: 1, onBeforeMergeableQuality: true, browser: true },
  })
  assert.deepEqual(await readRegistry(memFs({ [FILE]: raw }), ENV), {
    projects: [APP_A],
    preferences: { autopilot: false, eco: true, onBeforeMergeableQuality: true, browser: true }, // ecoPlanning (non-boolean) + bogus dropped
    projectPreferences: {},
  })
})

test('every boolean preference survives a save; the sanitizer cannot silently drop one (#944)', async () => {
  // `allOn` is typed over the boolean keys computed from `Preferences` itself, so adding a
  // boolean preference without listing it here is a compile error in this test — and a key the
  // sanitizer's list misses fails the round-trip below, the write-then-vanish shape #944 closes.
  type BooleanKey = {
    [K in keyof Preferences]-?: NonNullable<Preferences[K]> extends boolean ? K : never
  }[keyof Preferences]
  const allOn: Record<BooleanKey, boolean> = {
    autopilot: true,
    technical: true,
    vanilla: true,
    eco: true,
    ecoPlanning: true,
    ecoResearch: true,
    ecoMaintenance: true,
    onBeforeMergeableQuality: true,
    browser: true,
    transparent: true,
    notifyBrowser: true,
    notifyDiscord: true,
    discordBot: true,
    notifyNewActivity: true,
    notifyHumanIntervention: true,
    autoPm: true,
  }
  const fs = memFs()
  await writePreferences(allOn, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), allOn)
})

// Per-project run options (#840): a project overrides only what it sets, the rest falls through.

test('resolvePreferences lets a project override only the keys it stores', async () => {
  const global = { autopilot: true, technical: false, model: 'sonnet', theme: 'dark' as const }
  assert.deepEqual(resolvePreferences(global, { technical: true, model: 'opus' }), {
    autopilot: true, // untouched by the project
    technical: true, // overridden
    model: 'opus', // overridden
    theme: 'dark', // global-only key, never project-scoped
  })
  // A project that stores nothing behaves exactly as the global object does today.
  assert.deepEqual(resolvePreferences(global, {}), global)
  assert.deepEqual(resolvePreferences(global, undefined), global)
})

test('a project can override a global option to false, not just switch it on', async () => {
  // The point of #800: the old OR merge could only ever add. Storing `false` has to win.
  assert.equal(resolvePreferences({ autopilot: true }, { autopilot: false }).autopilot, false)
})

test('writeProjectPreferences stores one project without touching the globals or its siblings', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A, APP_B], preferences: { autopilot: false } }) })
  await writeProjectPreferences(APP_A.id, { technical: true, model: 'opus' }, fs, ENV)
  await writeProjectPreferences(APP_B.id, { eco: true }, fs, ENV)

  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { autopilot: false },
    projectPreferences: {
      [APP_A.id]: { technical: true, model: 'opus' },
      [APP_B.id]: { eco: true },
    },
  })
  assert.deepEqual(await readProjectPreferences(APP_A.id, fs, ENV), { technical: true, model: 'opus' })
  assert.deepEqual(await readPreferences(fs, ENV), { autopilot: false })
})

test('a project storing nothing drops its entry rather than leaving an empty object', async () => {
  const fs = memFs()
  await writeProjectPreferences(APP_A.id, { technical: true }, fs, ENV)
  await writeProjectPreferences(APP_A.id, {}, fs, ENV)
  // "Overrides nothing" has one representation, and the block disappears with the last entry.
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), { projects: [], preferences: {} })
  assert.deepEqual(await readProjectPreferences(APP_A.id, fs, ENV), {})
})

test('a hand-edited projectPreferences block is read forgivingly', async () => {
  const raw = JSON.stringify({
    projects: [APP_A],
    preferences: {},
    projectPreferences: { [APP_A.id]: { technical: true, bogus: 1 }, 'gone-1a2b': 'nonsense', '': { eco: true } },
  })
  const registry = await readRegistry(memFs({ [FILE]: raw }), ENV)
  assert.deepEqual(registry.projectPreferences, { [APP_A.id]: { technical: true } })
})

test('removing a project takes its overrides with it', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A, APP_B], preferences: {} }) })
  await writeProjectPreferences(APP_A.id, { technical: true }, fs, ENV)
  await writeProjectPreferences(APP_B.id, { eco: true }, fs, ENV)
  assert.equal(await removeProject(APP_A.id, fs, ENV), true)

  // Re-adding the same path starts clean rather than inheriting the old project's settings.
  assert.deepEqual(await readProjectPreferences(APP_A.id, fs, ENV), {})
  assert.deepEqual(await readProjectPreferences(APP_B.id, fs, ENV), { eco: true })
})

test('writePreferences leaves the per-project block alone', async () => {
  const fs = memFs()
  await writeProjectPreferences(APP_A.id, { technical: true }, fs, ENV)
  await writePreferences({ autopilot: false }, fs, ENV)
  assert.deepEqual(await readProjectPreferences(APP_A.id, fs, ENV), { technical: true })
  assert.deepEqual(await readPreferences(fs, ENV), { autopilot: false })
})

test('readPreferences on a missing / legacy file is {}', async () => {
  assert.deepEqual(await readPreferences(memFs(), ENV), {})
  assert.deepEqual(await readPreferences(memFs({ [FILE]: JSON.stringify([APP_A]) }), ENV), {})
})

test('writePreferences persists sanitized prefs and preserves the project list', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A, APP_B]) })
  await writePreferences({ autopilot: false, technical: true, bogus: 3 } as never, fs, ENV)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { autopilot: false, technical: true },
  })
  // The project list still reads back unchanged.
  assert.deepEqual(await listProjects(fs, ENV), [APP_A, APP_B])
})

test('writePreferences round-trips the notifyDiscord toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ notifyDiscord: true }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { notifyDiscord: true })
})

test('writePreferences round-trips the notifyNewActivity toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ notifyNewActivity: true }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { notifyNewActivity: true })
})

test('writePreferences round-trips the notifyHumanIntervention toggle (#627)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  // Default is on, so the persisted value that matters is the explicit opt-out.
  await writePreferences({ notifyHumanIntervention: false }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { notifyHumanIntervention: false })
})

test('writePreferences round-trips the transparent toggle (#625)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ transparent: true }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { transparent: true })
})

test('writePreferences keeps the model string but drops a blank one (#628)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ model: '  opus  ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { model: 'opus' }) // trimmed
  await writePreferences({ model: '   ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), {}) // blank -> no choice, dropped
})

test('writePreferences keeps a known agent and drops an unknown one (#650)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ agent: 'codex' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { agent: 'codex' })
  await writePreferences({ agent: 'gpt-9000' } as never, fs, ENV) // not in the known set
  assert.deepEqual(await readPreferences(fs, ENV), {}) // dropped
})

test('writePreferences trims a preferred editor and drops a blank one (#727)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ editor: '  cursor  ' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { editor: 'cursor' }) // trimmed
  await writePreferences({ editor: '   ' }, fs, ENV) // blank = no choice
  assert.deepEqual(await readPreferences(fs, ENV), {}) // dropped
})

test('writePreferences keeps a known theme and drops an unknown one (#725)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ theme: 'dark' }, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), { theme: 'dark' })
  await writePreferences({ theme: 'solarized' } as never, fs, ENV) // not in the known set
  assert.deepEqual(await readPreferences(fs, ENV), {}) // dropped, falls back to system
})

test('writePreferences keeps well-formed custom presets and drops malformed ones (#626)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences(
    {
      customPresets: [
        { id: 'a', label: '  Deep review  ', prompt: '  Audit this PR.  ' }, // trimmed
        { id: 'b', label: '', prompt: 'no label' }, // dropped (empty label)
        { id: 'c', label: 'no prompt', prompt: '  ' }, // dropped (empty prompt)
        { id: 'a', label: 'dup id', prompt: 'x' }, // dropped (duplicate id)
        { label: 'no id', prompt: 'x' }, // dropped (missing id)
        'nonsense', // dropped (not an object)
      ],
    } as never,
    fs,
    ENV,
  )
  assert.deepEqual(await readPreferences(fs, ENV), {
    customPresets: [{ id: 'a', label: 'Deep review', prompt: 'Audit this PR.' }],
  })
})

test('writePreferences omits customPresets entirely when none survive (#626)', async () => {
  const fs = memFs({ [FILE]: JSON.stringify([APP_A]) })
  await writePreferences({ customPresets: [{ id: '', label: 'x', prompt: 'y' }] } as never, fs, ENV)
  assert.deepEqual(await readPreferences(fs, ENV), {}) // empty list -> field left off
})

test('addProject preserves existing preferences', async () => {
  const fs = memFs({ [FILE]: JSON.stringify({ projects: [APP_A], preferences: { autopilot: false } }) })
  await addProject('/repos/app-b', APP_B.addedAt, fs, ENV)
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), {
    projects: [APP_A, APP_B],
    preferences: { autopilot: false },
  })
})

test('registryPreferencesStore round-trips through the same file', async () => {
  const fs = memFs()
  const store = registryPreferencesStore(fs, ENV)
  assert.deepEqual(await store.read(), {})
  await store.save({ vanilla: true })
  assert.deepEqual(await store.read(), { vanilla: true })
})

