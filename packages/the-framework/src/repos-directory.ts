import { join } from 'node:path'
import { nodeFs, type NodeFs } from './node-fs.js'

/**
 * The repos-directory helper (#1123): find the git repos directly inside a directory the user
 * pointed The Framework at, so the daemon can auto-register them when the opt-in is on.
 *
 * The fs is a seam so this is unit-testable without touching disk, matching the rest of the package.
 */

/** The narrow fs the scan needs: list a directory and test its entries. {@link nodeFs} satisfies it. */
export type ReposDirectoryFs = Pick<NodeFs, 'readdir' | 'isDirectory' | 'exists'>

/**
 * The immediate subdirectories of `dir` that are git repos: a child directory holding a `.git`
 * (a directory in a normal clone, a file in a worktree or submodule). Returns absolute paths, sorted.
 *
 * Only one level deep on purpose (#1123): the auto-grant's blast radius is "this directory of repos",
 * not the whole tree beneath it. A missing `dir` yields `[]` (readdir already swallows that), so it
 * never throws on boot.
 */
export async function listReposInDirectory(dir: string, fs: ReposDirectoryFs = nodeFs()): Promise<string[]> {
  const repos: string[] = []
  for (const name of (await fs.readdir(dir)).sort()) {
    const child = join(dir, name)
    if (!(await fs.isDirectory(child))) continue
    const git = join(child, '.git')
    if ((await fs.exists(git)) || (await fs.isDirectory(git))) repos.push(child)
  }
  return repos
}
