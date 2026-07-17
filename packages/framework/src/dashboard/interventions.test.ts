import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildInterventions, type OpenPr } from './interventions.js'
import type { ProjectSummary } from './projects.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true })

test('buildInterventions rolls up open non-draft PRs across projects, newest first', async () => {
  const prsByPath: Record<string, OpenPr[]> = {
    '/a': [
      { number: 7, title: 'add cart', url: 'u7', isDraft: false, createdAt: '2026-07-10T00:00:00Z' },
      { number: 8, title: 'wip spike', url: 'u8', isDraft: true, createdAt: '2026-07-12T00:00:00Z' }, // draft -> excluded
    ],
    '/b': [{ number: 3, title: 'fix login', url: 'u3', isDraft: false, createdAt: '2026-07-15T00:00:00Z' }],
    '/c': [], // no open PRs -> contributes nothing
  }
  const prs = async (cwd: string): Promise<OpenPr[]> => prsByPath[cwd] ?? []
  const items = await buildInterventions([project('a', '/a'), project('b', '/b'), project('c', '/c')], { prs })

  // Newest PR first; the draft is gone.
  assert.deepEqual(
    items.map(i => ({ project: i.projectId, number: i.number, title: i.title })),
    [
      { project: 'b', number: 3, title: 'fix login' },
      { project: 'a', number: 7, title: 'add cart' },
    ],
  )
  assert.ok(items.every(i => i.kind === 'pr'))
})

test('buildInterventions skips a project whose PR lookup throws', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> => {
    if (cwd === '/boom') throw new Error('gh exploded')
    return [{ number: 1, title: 'ok', url: 'u1', isDraft: false }]
  }
  const items = await buildInterventions([project('boom', '/boom'), project('ok', '/ok')], { prs })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
})

test('buildInterventions returns [] when nothing is open anywhere', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  assert.deepEqual(await buildInterventions([project('a', '/a')], { prs }), [])
})
