import { Fragment, useMemo, useState } from 'react'
import { Check, FileIcon } from 'lucide-react'
import { onProjectFileStatus } from '../server/reads.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { FileDiffHover } from './FileDiffHover.js'
import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderPanel,
  SubFiles,
  FileItem,
} from './animate-ui/components/base/files/index.js'

type FileGitStatus = 'untracked' | 'modified' | 'deleted'

/** Stable, so the `useMemo` on `status` doesn't re-run for a fresh empty object. */
const EMPTY_STATUS: Record<string, FileGitStatus> = {}

// The project panel's file tree (#492): a lazy, collapsible tree built from the flat
// `git ls-files` list (onProjectFiles, shared with the `#` picker #504). It is a file-level
// CONTEXT PICKER, not an editor — clicking a file toggles it in the run Context, the same
// set the `#` chips and the whole-repo Context selector feed. Localhost-only: no files (the
// relay has no checkout) renders nothing. Uses the animate-ui Files primitives for the
// animated folder expand/collapse and hover highlight, plus per-file git-status dots.

type TreeNode = {
  name: string
  path: string
  dirs: Map<string, TreeNode>
  files: string[]
}

/** Build a nested tree from repo-relative paths like `src/dashboard/foo.ts`. */
function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      const childPath = node.path ? `${node.path}/${seg}` : seg
      let child = node.dirs.get(seg)
      if (!child) {
        child = { name: seg, path: childPath, dirs: new Map(), files: [] }
        node.dirs.set(seg, child)
      }
      node = child
    }
    node.files.push(p)
  }
  return root
}

/** Roll each changed file's status up to its ancestor folders so a folder dots when dirty. */
function foldersFromStatus(status: Record<string, FileGitStatus>): Map<string, FileGitStatus> {
  const dirs = new Map<string, FileGitStatus>()
  for (const [path, st] of Object.entries(status)) {
    const parts = path.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!
      const prev = dirs.get(acc)
      dirs.set(acc, prev && prev !== st ? 'modified' : st) // mixed children read as modified
    }
  }
  return dirs
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export function FileTree({
  projectId,
  runId,
  files,
  selected,
  onToggle,
}: {
  projectId: string
  /** The selected run, so the dots describe its worktree and not the project root (#815). */
  runId?: string | null | undefined
  files: string[]
  selected: Set<string>
  onToggle: (path: string) => void
}) {
  const [query, setQuery] = useState('')

  // Per-file git status for the dots (#492): polled so it tracks a run editing files. Scoped to
  // the selected run's worktree (#815) so the dots agree with the branch and Serve in the action
  // bar right above, which have resolved the worktree since #738.
  const { value: status } = usePolled<Record<string, FileGitStatus>>(
    () => onProjectFileStatus(projectId, runId ?? undefined),
    EMPTY_STATUS,
    8_000,
    [projectId, runId],
  )

  const folderStatus = useMemo(() => foldersFromStatus(status), [status])

  // A search narrows to matching files (and the folders on their way), so the tree is usable
  // on a large repo without scrolling. Empty query shows everything.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? files.filter(f => f.toLowerCase().includes(q)) : files
  }, [files, query])

  const tree = useMemo(() => buildTree(visible), [visible])

  const renderNode = (node: TreeNode) => (
    <>
      {[...node.dirs.values()].sort(byName).map(dir => {
        const dirGit = folderStatus.get(dir.path)
        return (
          <FolderItem key={dir.path} value={dir.path}>
            <FolderTrigger {...(dirGit ? { gitStatus: dirGit } : {})}>{dir.name}</FolderTrigger>
            <FolderPanel>
              <SubFiles>{renderNode(dir)}</SubFiles>
            </FolderPanel>
          </FolderItem>
        )
      })}
      {[...node.files]
        .sort((a, b) => a.localeCompare(b))
        .map(path => {
          const name = path.slice(path.lastIndexOf('/') + 1)
          const isOn = selected.has(path)
          const git = status[path]
          const item = (
            <FileItem
              icon={isOn ? Check : FileIcon}
              title={path}
              className={'pointer-events-auto cursor-pointer' + (isOn ? ' text-primary' : '')}
              onClick={() => onToggle(path)}
              {...(git ? { gitStatus: git } : {})}
            >
              {name}
            </FileItem>
          )
          // Only a changed file has a diff to show, so only it gets the hover card (#816).
          return git ? (
            <FileDiffHover key={path} projectId={projectId} runId={runId} path={path}>
              {item}
            </FileDiffHover>
          ) : (
            <Fragment key={path}>{item}</Fragment>
          )
        })}
    </>
  )

  if (files.length === 0) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter files…"
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
      />
      <Files className="min-h-0 flex-1 text-sm">{renderNode(tree)}</Files>
    </div>
  )
}
