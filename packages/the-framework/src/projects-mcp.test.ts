import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { McpTestClient } from '@gemstack/mcp/testing'
import { makeProjectsServer, projectsMcpServers } from './projects-mcp.js'
import { projectId, type RegistryFs } from './registry.js'
import { watchControl, type ControlEntry } from './control.js'
import { metaFromEvents } from './store/run-store.js'

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

/** Parse a tool result's single JSON text block. */
function json(result: { content: Array<{ type: string; text?: string }> }): any {
  const block = result.content[0]
  assert.equal(block?.type, 'text')
  return JSON.parse(block!.text!)
}

async function tmpRun(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'framework-projects-'))
}

/** Poll until the predicate holds or the timeout passes. */
async function until(check: () => boolean, timeoutMs = 3000): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 20) {
    if (check()) return true
    await new Promise(r => setTimeout(r, 20))
  }
  return check()
}

test('create_project registers a project, and list_projects reads it back (#1121)', async () => {
  const fs = memFs()
  const env = { XDG_CONFIG_HOME: '/cfg' }
  const Server = makeProjectsServer({ fs, env, now: () => '2026-07-24T00:00:00.000Z' })
  const client = new McpTestClient(Server)

  // Both tools are advertised under their verbatim names.
  const tools = (await client.listTools()).map(t => t.name).sort()
  assert.deepEqual(tools, ['create_project', 'list_projects'])

  assert.deepEqual(json(await client.callTool('list_projects')).projects, [])

  const repo = resolve('/repos/my-app')
  const created = json(await client.callTool('create_project', { path: repo }))
  assert.equal(created.project.path, repo)
  assert.equal(created.project.id, projectId(repo))

  const listed = json(await client.callTool('list_projects')).projects
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, projectId(repo))
})

test('create_project signals the run over the control channel, and watchControl parses the bind (#1121)', async () => {
  const cwd = await tmpRun()
  const seen: ControlEntry[] = []
  const watcher = watchControl(cwd, e => seen.push(e), 20)
  try {
    // Default appendControl, so this exercises the real tool -> control.jsonl -> watcher chain.
    const Server = makeProjectsServer({ fs: memFs(), env: { XDG_CONFIG_HOME: '/cfg' }, runCwd: cwd })
    const client = new McpTestClient(Server)

    const repo = resolve('/repos/bind-me')
    const created = json(await client.callTool('create_project', { path: repo }))
    assert.equal(created.bound, true)

    assert.ok(await until(() => seen.length === 1), `saw ${seen.length} entries`)
    assert.deepEqual(seen[0], { kind: 'bind', projectId: projectId(repo) })
  } finally {
    watcher.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('without a run cwd, create_project registers but does not bind (#1121)', async () => {
  const Server = makeProjectsServer({ fs: memFs(), env: { XDG_CONFIG_HOME: '/cfg' } })
  const client = new McpTestClient(Server)
  const created = json(await client.callTool('create_project', { path: resolve('/repos/unbound') }))
  assert.equal(created.bound, false)
})

test('a bind event folds onto the run meta as boundProjectId (#1121)', () => {
  const id = projectId(resolve('/repos/my-app'))
  const meta = metaFromEvents([{ kind: 'bind', projectId: id }], '2026-07-24T00:00:00.000Z')
  assert.equal(meta.boundProjectId, id)
})

test('projectsMcpServers spawns the framework bin and carries the run cwd + config home (#1121)', () => {
  const spec = projectsMcpServers('/opt/the-framework/dist/bin.js', '/tmp/topic-run', {
    XDG_CONFIG_HOME: '/cfg',
    HOME: '/home/dev',
  })
  assert.deepEqual(spec.projects!.args, ['/opt/the-framework/dist/bin.js', 'mcp-projects'])
  assert.equal(spec.projects!.env!.FRAMEWORK_RUN_CWD, '/tmp/topic-run')
  assert.equal(spec.projects!.env!.XDG_CONFIG_HOME, '/cfg')
})
