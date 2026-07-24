import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveAwaitGate, type BindProjectDeps } from './await-gate.js'
import { parseAwaitGate, parseBindProjectGate, parseCreateProjectGate, NO_PROJECTS_TO_BIND } from './turn-gate.js'
import { addProject, listProjects, projectId, resolveProjectPath, type RegistryFs } from './registry.js'
import { appendControl, watchControl, type ControlEntry } from './control.js'
import { metaFromEvents } from './store/run-store.js'
import { composeRunSystem, topicBindBlock, TOPIC_BIND_PROTOCOL } from './system-prompt.js'
import { SIGNAL_PROTOCOL } from './turn-gate.js'
import type { FrameworkEvent, ChoiceRequest } from './events.js'

// #1121: a project-less topic run (#1120) ends a turn on an `await-bind-project` /
// `await-create-project` block, and the framework resolves it by registering + binding the project.
// The registered projects are injected into the topic run's context as the "read" half (#1129).
// The actual worktree re-home the bind implies is a separate follow-up (#1122).

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

/**
 * A {@link BindProjectDeps} bound to an in-memory registry, recording each bind into `recorded`.
 * `addProject` mirrors the real CLI wiring: it validates the path (via {@link resolveProjectPath}),
 * reports whether it already existed, and declines a bad one. `isDirectory` defaults to "every path
 * is a real directory" so the happy-path tests need not stage a fake fs.
 */
function memBind(
  fs: RegistryFs,
  recorded: string[],
  isDirectory: (p: string) => Promise<boolean> = async () => true,
): BindProjectDeps {
  return {
    listProjects: async () => (await listProjects(fs, ENV)).map(p => ({ id: p.id, path: p.path })),
    addProject: async path => {
      const resolved = await resolveProjectPath(path, isDirectory)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      const already = (await listProjects(fs, ENV)).some(p => p.path === resolved.path)
      const record = await addProject(resolved.path, ISO, fs, ENV)
      return { ok: true, project: { id: record.id, path: record.path }, created: !already }
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

test('a topic run injects the registered projects as context; empty steers to create; a normal run gets none (#1121/#1129)', () => {
  const populated = composeRunSystem({ topic: true, topicProjects: ['/repos/app', '/repos/api'] })
  assert.ok(populated.includes('/repos/app') && populated.includes('/repos/api'), 'both project paths are listed')
  assert.ok(populated.includes('app:') && populated.includes('api:'), 'each path shows its basename as the name')

  const empty = composeRunSystem({ topic: true, topicProjects: [] })
  assert.ok(empty.includes('No projects are registered yet'), 'an empty registry steers the agent to create-project')

  // No topicProjects wired (a browser preview): the how-to shows, but no list and no "empty" note.
  const unwired = composeRunSystem({ topic: true })
  assert.ok(unwired.includes(TOPIC_BIND_PROTOCOL) && !unwired.includes('No projects are registered yet'))

  // topicProjects is ignored off a topic run, so a normal channel stays byte-identical.
  assert.equal(composeRunSystem({ topicProjects: ['/repos/app'] }), composeRunSystem())
})

test('topicBindBlock: undefined = how-to only, [] = create hint, a list names each path (#1121)', () => {
  assert.equal(topicBindBlock(undefined), TOPIC_BIND_PROTOCOL)
  assert.ok(topicBindBlock([]).includes('No projects are registered yet'))
  const listed = topicBindBlock(['/home/me/repos/my-app'])
  assert.ok(listed.includes('my-app:') && listed.includes('/home/me/repos/my-app'))
})

test('resolveProjectPath rejects a relative, empty, or non-directory path and resolves a real one (#1121)', async () => {
  assert.deepEqual(await resolveProjectPath('   '), { ok: false, error: 'no path was given' })
  const rel = await resolveProjectPath('repos/app', async () => true)
  assert.equal(rel.ok, false)
  const missing = await resolveProjectPath('/repos/gone', async () => false)
  assert.equal(missing.ok, false)
  const ok = await resolveProjectPath('/repos/app', async () => true)
  assert.deepEqual(ok, { ok: true, path: resolve('/repos/app') })
})

test('an await-create-project gate with a relative path declines cleanly and registers nothing (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: 'repos/app' }, 0, {
    emit: () => {},
    bind: memBind(fs, recorded),
  })
  assert.match(answer, /Could not register that project/)
  assert.deepEqual(recorded, [])
  assert.deepEqual(await listProjects(fs, ENV), [])
})

test('an await-create-project gate with a non-directory path declines cleanly and registers nothing (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: resolve('/repos/nope') }, 0, {
    emit: () => {},
    bind: memBind(fs, recorded, async () => false),
  })
  assert.match(answer, /Could not register that project/)
  assert.deepEqual(recorded, [])
  assert.deepEqual(await listProjects(fs, ENV), [])
})

test('an await-create-project gate with no path declines without registering (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?' }, 0, {
    emit: () => {},
    bind: memBind(fs, recorded),
  })
  assert.match(answer, /nothing was registered/)
  assert.deepEqual(recorded, [])
})

test('re-registering an already-registered path is idempotent and still binds the run (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const repo = resolve('/repos/twice')
  await addProject(repo, ISO, fs, ENV)

  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: repo }, 0, {
    emit: () => {},
    bind: memBind(fs, recorded),
  })
  assert.match(answer, /already registered/)
  assert.deepEqual(recorded, [projectId(repo)], 'the existing record is surfaced and the bind still recorded')
  assert.equal((await listProjects(fs, ENV)).length, 1, 'no duplicate row is added')
})

test('an await-bind-project pick is coerced to a registered id, so a stale pick still binds safely (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const repo = resolve('/repos/real')
  await addProject(repo, ISO, fs, ENV)
  // requestChoices guards invalid picks by falling back to the recommended (a real) id, so a
  // stale/ghost pick can never bind to a project that is not in the list.
  const answer = await resolveAwaitGate({ kind: 'bind-project', title: 'Which?' }, 0, {
    emit: () => {},
    requestChoice: async () => ({ picked: 'ghost-id' }),
    bind: memBind(fs, recorded),
  })
  assert.match(answer, /Bound this run to/)
  assert.deepEqual(recorded, [projectId(repo)])
})

test('an await-create-project gate recommends Approve, so a headless run auto-accepts the grant (#1121)', async () => {
  const fs = memFs()
  const recorded: string[] = []
  const choices: ChoiceRequest[] = []
  // No requestChoice: the recommended option IS the pick, exactly like the plan confirmation gate.
  const answer = await resolveAwaitGate({ kind: 'create-project', title: 'Register it?', path: resolve('/repos/auto') }, 0, {
    emit: e => {
      if (e.kind === 'choice') choices.push(e)
    },
    bind: memBind(fs, recorded),
  })
  assert.equal(choices.length, 1)
  assert.equal(choices[0]!.recommended, 'approve', 'the grant is recommended so autopilot/headless auto-accept it')
  assert.equal(choices[0]!.confirm, true, 'it renders as a confirmation, like the plan gate')
  assert.match(answer, /Registered and bound/)
  assert.deepEqual(recorded, [projectId(resolve('/repos/auto'))])
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
