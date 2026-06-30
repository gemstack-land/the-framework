import { defineConnector } from '@gemstack/connectors'
import { z } from 'zod'
import { gh } from './client.js'

export { GitHubError } from './client.js'

const repo = { owner: z.string().min(1), repo: z.string().min(1) }
const enc = encodeURIComponent

/** Slim an API issue (or PR-as-issue) down to the fields an agent needs. */
function slimIssue(i: Record<string, any>) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.user?.login,
    labels: Array.isArray(i.labels) ? i.labels.map((l: any) => (typeof l === 'string' ? l : l?.name)) : [],
    comments: i.comments,
    isPullRequest: i.pull_request != null,
    url: i.html_url,
  }
}

function slimPull(p: Record<string, any>) {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    draft: p.draft,
    author: p.user?.login,
    head: p.head?.ref,
    base: p.base?.ref,
    merged: p.merged,
    mergeable: p.mergeable,
    url: p.html_url,
  }
}

/**
 * GitHub connector: read and act on issues, pull requests, and repo files.
 *
 * Auth is a token with `repo` scope. Declared as `pat` (set `GITHUB_TOKEN`),
 * but an OAuth bearer works identically — the orchestrator supplies whichever
 * via the mount `credentials` option.
 */
export default defineConnector({
  id: 'github',
  name: 'GitHub',
  instructions: 'Read and act on GitHub issues, pull requests, and repository files.',
  auth: { type: 'pat', env: 'GITHUB_TOKEN', description: 'GitHub token with `repo` scope (PAT or OAuth bearer)' },
  tools: [
    {
      name: 'get-repo',
      description: 'Get metadata for a repository.',
      schema: z.object({ ...repo }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { owner: string; repo: string }, ctx) => {
        const r = await gh<Record<string, any>>(ctx, 'GET', `/repos/${enc(input.owner)}/${enc(input.repo)}`)
        return {
          fullName: r.full_name,
          description: r.description,
          private: r.private,
          defaultBranch: r.default_branch,
          stars: r.stargazers_count,
          openIssues: r.open_issues_count,
          url: r.html_url,
        }
      },
    },
    {
      name: 'list-issues',
      description: 'List issues in a repository (newest first). Excludes pull requests.',
      schema: z.object({
        ...repo,
        state: z.enum(['open', 'closed', 'all']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { owner: string; repo: string; state?: string; limit?: number }, ctx) => {
        const q = new URLSearchParams({ state: input.state ?? 'open', per_page: String(input.limit ?? 30) })
        const issues = await gh<Record<string, any>[]>(
          ctx,
          'GET',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/issues?${q}`,
        )
        return issues.filter((i) => i.pull_request == null).map(slimIssue)
      },
    },
    {
      name: 'get-issue',
      description: 'Get a single issue by number.',
      schema: z.object({ ...repo, number: z.number().int().positive() }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { owner: string; repo: string; number: number }, ctx) => {
        const i = await gh<Record<string, any>>(
          ctx,
          'GET',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/issues/${input.number}`,
        )
        return { ...slimIssue(i), body: i.body }
      },
    },
    {
      name: 'list-pull-requests',
      description: 'List pull requests in a repository.',
      schema: z.object({
        ...repo,
        state: z.enum(['open', 'closed', 'all']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { owner: string; repo: string; state?: string; limit?: number }, ctx) => {
        const q = new URLSearchParams({ state: input.state ?? 'open', per_page: String(input.limit ?? 30) })
        const pulls = await gh<Record<string, any>[]>(
          ctx,
          'GET',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/pulls?${q}`,
        )
        return pulls.map(slimPull)
      },
    },
    {
      name: 'get-pull-request',
      description: 'Get a single pull request by number.',
      schema: z.object({ ...repo, number: z.number().int().positive() }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { owner: string; repo: string; number: number }, ctx) => {
        const p = await gh<Record<string, any>>(
          ctx,
          'GET',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/pulls/${input.number}`,
        )
        return { ...slimPull(p), body: p.body, additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files }
      },
    },
    {
      name: 'get-file',
      description: 'Read the contents of a file in a repository.',
      schema: z.object({ ...repo, path: z.string().min(1), ref: z.string().optional() }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { owner: string; repo: string; path: string; ref?: string }, ctx) => {
        const q = input.ref ? `?ref=${enc(input.ref)}` : ''
        const f = await gh<Record<string, any>>(
          ctx,
          'GET',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/contents/${input.path.split('/').map(enc).join('/')}${q}`,
        )
        if (Array.isArray(f)) return { error: `path "${input.path}" is a directory, not a file` }
        const content =
          f.encoding === 'base64' && typeof f.content === 'string'
            ? Buffer.from(f.content, 'base64').toString('utf8')
            : f.content
        return { path: f.path, size: f.size, sha: f.sha, content }
      },
    },
    {
      name: 'search-issues',
      description: 'Search issues and pull requests across GitHub with a query (GitHub search syntax).',
      schema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { query: string; limit?: number }, ctx) => {
        const q = new URLSearchParams({ q: input.query, per_page: String(input.limit ?? 20) })
        const res = await gh<{ total_count: number; items: Record<string, any>[] }>(ctx, 'GET', `/search/issues?${q}`)
        return { totalCount: res.total_count, items: res.items.map(slimIssue) }
      },
    },
    {
      name: 'comment-on-issue',
      description: 'Add a comment to an issue or pull request.',
      schema: z.object({ ...repo, number: z.number().int().positive(), body: z.string().min(1) }),
      annotations: { openWorld: true },
      handle: async (input: { owner: string; repo: string; number: number; body: string }, ctx) => {
        const c = await gh<Record<string, any>>(
          ctx,
          'POST',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/issues/${input.number}/comments`,
          { body: input.body },
        )
        return { id: c.id, url: c.html_url }
      },
    },
    {
      name: 'create-issue',
      description: 'Open a new issue in a repository.',
      schema: z.object({
        ...repo,
        title: z.string().min(1),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
      }),
      annotations: { openWorld: true },
      handle: async (
        input: { owner: string; repo: string; title: string; body?: string; labels?: string[] },
        ctx,
      ) => {
        const payload: Record<string, unknown> = { title: input.title }
        if (input.body != null) payload.body = input.body
        if (input.labels != null) payload.labels = input.labels
        const i = await gh<Record<string, any>>(
          ctx,
          'POST',
          `/repos/${enc(input.owner)}/${enc(input.repo)}/issues`,
          payload,
        )
        return { number: i.number, url: i.html_url }
      },
    },
  ],
})
