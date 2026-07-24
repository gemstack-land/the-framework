import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveAwaitGate, type BindProjectDeps } from './await-gate.js'
import { parseAwaitGate, parseBindProjectGate, parseCreateProjectGate, NO_PROJECTS_TO_BIND } from './turn-gate.js'
import { addProject, listProjects, projectId, type RegistryFs } from './registry.js'
import { appendControl, watchControl, type ControlEntry } from './control.js'
import { metaFromEvents } from './store/run-store.js'
import { composeRunSystem, TOPIC_BIND_PROTOCOL } from './system-prompt.js'
import { SIGNAL_PROTOCOL } from './turn-gate.js'
import type { FrameworkEvent } from './events.js'

// The gates spike for #1121: a project-less topic run (#1120) ends a turn on an `await-bind-project`
// / `await-create-project` block, and the framework resolves it by registering + binding the
// project. Mirrors projects-mcp.test.ts so the two spikes are comparable — only the trigger differs.

const ISO = '2026-07-24T00:00:00.000Z'
const ENV = { XDG_CONFIG_HOME: '/cfg' }

/** An in-memory {@link RegistryFs} so the registry round-trips without touching disk. */
function memFs(): RegistryFs {
  const files = new Map<string, string>()
  return {
    async read(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      files.set(path, contents)
    },
    async mkdir() {},
    async rename(from, to) {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    },
    async chmod() {},
  }
}

/** A {@link BindProjectDeps} bound to an in-memory registry, recording each bind into `recorded`. */
function memBind(fs: RegistryFs, recorded: string[]): BindProjectDeps {
  return {
    listProjects: async () => (await listProjects(fs, ENV)).map(p => ({ id: p.id, path: p.path })),
    addProject: async path => {
      const record = await addProject(path, ISO, fs, ENV)
      return { id: record.id, path: record.path }
    },
    recordBind: id => recorded.push(id),
  }
}

const createBlock = (body: string) => `I need a repo to work in.\n\n\`\`\`await-create-project\n${body}\n\`\`\``
const bindBlock = (body: string) => `Which project?\n\n\`\`\`await-bind-project\n${body}\n\`\`\``

test('parseAwaitGate recognises the bind + create-project gates alongside the other kinds (#1121)', () => {
  assert.equal(parseAwaitGate(bindBlock('{ "title": "Pick one" }'))?.kind, 'bind-project')
  const create = parseAwaitGate(createBlock('{ "title": "Register it", "path": "/repos/app" }'))
  assert.equal(create?.kind, 'create-project')
  assert.equal(create?.kind === 'create-project' ? create.path : '', '/repos/app')
})

test('parseCreateProjectGate reads the path, falls back on a blank title, and drops a non-string path', () => {
  assert.deepEqual(parseCreateProjectGate(createBlock('{ "title": "New app", "path": "/repos/app" }')), {
    title: 'New app',
    path: '/repos/app',
  })
  assert.deepEqual(parseCreateProjectGate(createBlock('{ "path": "/repos/app" }')), {
    title: 'Register and bind this project?',
    path: '/repos/app',
  })
  assert.deepEqual(parseCreateProjectGate(createBlock('{ "title": "New app", "path": 42 }')), { title: 'New app' })
})

test('parseBindProjectGate triggers even on an empty body, since the framework supplies the options', () => {
  assert.deepEqual(parseBindProjectGate(bindBlock('{}')), { title: 'Bind this run to a project' })
  assert.deepEqual(parseBindProjectGate(bindBlock('not json')), { title: 'Bind this run to a project' })
  assert.equal(parseBindProjectGate('all done'), undefined)
})

test('resolving an await-create-project gate registers the project and records the bind (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const repo = resolve('/repos/my-app')
  // No requestChoice: the headless path auto-accepts the recommended Approve, which IS the grant.
  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: repo }, 0, {
    emit: () => {},
    bind: memBind(fs, recorded),
  })

  assert.match(answer, /Registered and bound/)
  assert.deepEqual(recorded, [projectId(repo)])
  const listed = await listProjects(fs, ENV)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.path, repo)
})

test('a declined await-create-project gate registers nothing and binds nothing (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: resolve('/repos/no') }, 0, {
    emit: () => {},
    requestChoice: async () => ({ picked: 'decline' }),
    bind: memBind(fs, recorded),
  })

  assert.match(answer, /not to register/)
  assert.deepEqual(recorded, [])
  assert.deepEqual(await listProjects(fs, ENV), [])
})

test('resolving an await-bind-project gate picks a registered project and records the bind (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const repo = resolve('/repos/existing')
  await addProject(repo, ISO, fs, ENV)

  const answer = await resolveAwaitGate({ kind: 'bind-project', title: 'Which project?' }, 0, {
    emit: () => {},
    requestChoice: async req => {
      // The framework filled the options from the registry, not the agent's block.
      assert.deepEqual(req.options.map(o => o.label), [repo])
      return { picked: projectId(repo) }
    },
    bind: memBind(fs, recorded),
  })

  assert.match(answer, /Bound this run to/)
  assert.deepEqual(recorded, [projectId(repo)])
})

test('an await-bind-project gate with an empty registry has nothing to bind to (#1121)', async () => {
  const recorded: string[] = []
  const answer = await resolveAwaitGate({ kind: 'bind-project', title: 'Which project?' }, 0, {
    emit: () => {},
    bind: memBind(memFs(), recorded),
  })
  assert.equal(answer, NO_PROJECTS_TO_BIND)
  assert.deepEqual(recorded, [])
})

test('a topic run advertises the bind gate; a normal run does not, and the signal protocol stays last (#1121/#547)', () => {
  const topic = composeRunSystem({ topic: true })
  assert.ok(topic.includes(TOPIC_BIND_PROTOCOL), 'a topic run is told it can bind to a project')
  assert.ok(topic.includes('await-bind-project') && topic.includes('await-create-project'))
  assert.ok(topic.endsWith(SIGNAL_PROTOCOL), 'the signal protocol is still the last thing in the channel')
  assert.ok(!composeRunSystem().includes(TOPIC_BIND_PROTOCOL), 'a normal run says nothing about binding')
})

test('a bind event folds onto the run meta as boundProjectId (#1121)', () => {
  const id = projectId(resolve('/repos/my-app'))
  const events: FrameworkEvent[] = [{ kind: 'bind', projectId: id }]
  assert.equal(metaFromEvents(events, ISO).boundProjectId, id)
})

test('recordBind signals the run over the control channel, and watchControl parses the bind (#1121)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-gate-bind-'))
  const seen: ControlEntry[] = []
  const watcher = watchControl(cwd, e => seen.push(e), 20)
  try {
    const fs = memFs()
    const repo = resolve('/repos/wired')
    // The CLI wires recordBind to the control channel; here we exercise that real chain end to end.
    const bind: BindProjectDeps = { ...memBind(fs, []), recordBind: id => void appendControl(cwd, { kind: 'bind', projectId: id }) }
    await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: repo }, 0, { emit: () => {}, bind })

    for (let waited = 0; waited < 3000 && seen.length === 0; waited += 20) await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(seen, [{ kind: 'bind', projectId: projectId(repo) }])
  } finally {
    watcher.close()
    await rm(cwd, { recursive: true, force: true })
  }
})
