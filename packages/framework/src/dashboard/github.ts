import { nodeGitRunner, type GitRunner } from '../project.js'

// The project panel's "Open on GitHub" (#489, part of #488). Derives the repo's github.com
// URL from its `origin` remote so the panel can link straight to it. A read of git state,
// safe anywhere — the relay has no local checkout, so it resolves to nothing there.

/**
 * Normalize a git remote URL to an `https://github.com/<owner>/<repo>` URL, or undefined when
 * it is not a GitHub remote. Handles the scp-style (`git@github.com:o/r.git`), ssh
 * (`ssh://git@github.com/o/r.git`), and https (`https://github.com/o/r.git`) forms, dropping
 * a `.git` suffix, an embedded credential, and a trailing slash.
 */
export function githubUrlFromRemote(remote: string): string | undefined {
  const url = remote.trim()
  const match =
    url.match(/^git@github\.com:(.+?)$/) ||
    url.match(/^ssh:\/\/git@github\.com\/(.+?)$/) ||
    url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/(.+?)$/)
  if (!match || !match[1]) return undefined
  const slug = match[1].replace(/\.git$/, '').replace(/\/$/, '')
  // Guard against a junk capture: a GitHub slug is `owner/repo`, both non-empty.
  if (!/^[^/]+\/[^/]+$/.test(slug)) return undefined
  return `https://github.com/${slug}`
}

/** The repo's GitHub URL from its `origin` remote, or undefined (no remote / not GitHub). */
export async function githubUrlFor(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  try {
    return githubUrlFromRemote(await git(['remote', 'get-url', 'origin'], cwd))
  } catch {
    return undefined
  }
}
