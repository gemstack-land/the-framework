import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  addProject,
  listProjects,
  projectId,
  registryPath,
  removeProject,
  REGISTRY_FILE,
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
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), [APP_A])

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
  assert.deepEqual(JSON.parse(fs.files.get(FILE)!), [APP_A])
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
