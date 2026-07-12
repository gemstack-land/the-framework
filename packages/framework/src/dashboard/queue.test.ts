import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseTodoItems, collectQueue } from './queue.js'
import type { ProjectSummary } from './projects.js'
import type { WorkspaceDoc } from './docs.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true })

test('parseTodoItems extracts task-list entries and their checked state', () => {
  const items = parseTodoItems('# TODO\n- [ ] ship it\n* [x] done thing\n  - [X] nested done\nnot a task\n- [ ]\n')
  assert.deepEqual(items, [
    { text: 'ship it', done: false },
    { text: 'done thing', done: true },
    { text: 'nested done', done: true },
  ])
})

test('collectQueue rolls up open TODO items per project, most-open first, skipping empties', async () => {
  const docs: Record<string, WorkspaceDoc[]> = {
    '/a': [{ name: 'TODO.md', content: '- [ ] one\n- [ ] two\n- [x] gone\n' }],
    '/b': [{ name: 'TODO_main.agent.md', content: '- [ ] only\n' }],
    '/c': [{ name: 'PLAN.md', content: '- [ ] not a todo doc\n' }], // no TODO doc -> skipped
    '/d': [{ name: 'TODO.md', content: '# nothing checkable\n' }], // TODO but no items -> skipped
  }
  const read = async (cwd: string): Promise<WorkspaceDoc[]> => docs[cwd] ?? []
  const queues = await collectQueue(
    [project('a', '/a'), project('b', '/b'), project('c', '/c'), project('d', '/d')],
    read,
  )
  assert.deepEqual(
    queues.map(q => ({ id: q.projectId, open: q.open, total: q.total })),
    [
      { id: 'a', open: 2, total: 3 },
      { id: 'b', open: 1, total: 1 },
    ],
  )
})

test('collectQueue skips a project whose docs read throws', async () => {
  const read = async (cwd: string): Promise<WorkspaceDoc[]> => {
    if (cwd === '/boom') throw new Error('unreadable')
    return [{ name: 'TODO.md', content: '- [ ] fine\n' }]
  }
  const queues = await collectQueue([project('boom', '/boom'), project('ok', '/ok')], read)
  assert.deepEqual(queues.map(q => q.projectId), ['ok'])
})
