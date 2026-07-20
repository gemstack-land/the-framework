import { join } from 'node:path'
import { THE_FRAMEWORK_DIR } from './framework-dir.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

/**
 * The `.the-framework/LOGS.md` project log (#378): a human-readable markdown
 * record of every loop, prompt, and build run in a project. Pure core over the
 * same {@link StoreFs} seam as the run store; the run-lifecycle wiring and UI
 * land in later issues (#379/#380).
 */

/** The directory, under the project root, that holds the log. Defined in its own node-free
 * module (#874) so the browser-reachable preset registry can share it; re-exported here
 * because this is where every existing import site expects to find it. */
export { THE_FRAMEWORK_DIR }

/** The markdown log file name. */
export const LOGS_FILE = 'LOGS.md'

/**
 * The `.the-framework/.gitignore` that keeps run state transient (#313): the dir
 * holds both the committed DB (LOGS.md) and the transient run logs, so this
 * ignores everything except LOGS.md and itself.
 */
export const LOGS_GITIGNORE =
  '# The Framework: only LOGS.md is the committed project DB; session state is transient.\n*\n!.gitignore\n!LOGS.md\n'

/** One project-log entry: a loop, or a standalone prompt/build. */
export interface LogEntry {
  /** ISO timestamp. */
  at: string
  kind: 'loop' | 'prompt' | 'build'
  /** Single-line intent/prompt summary. */
  title: string
  status: 'done' | 'stopped' | 'failed' | 'running'
  /** Claude Code session id. */
  sessionId?: string
  /** e.g. `https://claude.ai/code/<id>` */
  sessionLink?: string
  /** For a loop: constituent prompt summaries. */
  prompts?: string[]
}

const KINDS: readonly string[] = ['loop', 'prompt', 'build']
const STATUSES: readonly string[] = ['done', 'stopped', 'failed', 'running']

/** Heading field separator: a middle dot (U+00B7) with a space on each side. */
const SEP = ' · '

/** The one-time first line of the file, written on the first append. */
export const LOGS_HEADER = '# The Framework logs\n'

/** The log path under `cwd`. */
export function logsPath(cwd: string): string {
  return join(cwd, THE_FRAMEWORK_DIR, LOGS_FILE)
}

/** The `.gitignore` path under `cwd`'s `.the-framework/`. */
export function gitignorePath(cwd: string): string {
  return join(cwd, THE_FRAMEWORK_DIR, '.gitignore')
}

/** Markdown for one entry, starting at `## ` (no file header, no blank lines around it). */
export function renderLogEntry(entry: LogEntry): string {
  const lines = [
    `## ${entry.at}${SEP}${entry.kind}${SEP}${entry.title}`,
    '',
    `- status: ${entry.status}`,
  ]
  if (entry.sessionId) {
    lines.push(
      entry.sessionLink
        ? `- session: [${entry.sessionId}](${entry.sessionLink})`
        : `- session: ${entry.sessionId}`,
    )
  }
  if (entry.prompts && entry.prompts.length > 0) {
    lines.push('- prompts:')
    for (const prompt of entry.prompts) lines.push(`  - ${prompt}`)
  }
  return lines.join('\n')
}

/**
 * Parse every entry out of the markdown, in file order (append order, so
 * oldest-first). Forgiving: a malformed or torn entry is skipped, never thrown.
 */
export function parseLogs(md: string): LogEntry[] {
  const entries: LogEntry[] = []
  let block: string[] | undefined
  const flush = () => {
    const entry = block && parseEntry(block)
    if (entry) entries.push(entry)
    block = undefined
  }
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      block = [line]
    } else if (block) {
      block.push(line)
    }
    // Anything before the first `## ` (the file header) is ignored.
  }
  flush()
  return entries
}

/** Parse one `## `-headed block; `undefined` when a required field is missing/invalid. */
function parseEntry(lines: string[]): LogEntry | undefined {
  const heading = lines[0]?.slice('## '.length) ?? ''
  const parts = heading.split(SEP)
  const at = parts[0]
  const kind = parts[1]
  // Re-join the rest so a title containing the separator survives.
  const title = parts.slice(2).join(SEP)
  if (!at || !kind || !title || !KINDS.includes(kind)) return undefined

  let status: string | undefined
  let sessionId: string | undefined
  let sessionLink: string | undefined
  let prompts: string[] | undefined
  let inPrompts = false
  for (const line of lines.slice(1)) {
    if (inPrompts && line.startsWith('  - ')) {
      prompts!.push(line.slice('  - '.length))
      continue
    }
    inPrompts = false
    if (line.startsWith('- status: ')) {
      status = line.slice('- status: '.length).trim()
    } else if (line.startsWith('- session: ')) {
      const value = line.slice('- session: '.length).trim()
      const linked = /^\[(.+)\]\((.+)\)$/.exec(value)
      if (linked) {
        sessionId = linked[1]
        sessionLink = linked[2]
      } else {
        sessionId = value
      }
    } else if (line.trim() === '- prompts:') {
      prompts = []
      inPrompts = true
    }
  }
  if (!status || !STATUSES.includes(status)) return undefined

  const entry: LogEntry = {
    at,
    kind: kind as LogEntry['kind'],
    title,
    status: status as LogEntry['status'],
  }
  if (sessionId) entry.sessionId = sessionId
  if (sessionLink) entry.sessionLink = sessionLink
  if (prompts && prompts.length > 0) entry.prompts = prompts
  return entry
}

/**
 * Append one entry to `.the-framework/LOGS.md`, creating the dir and the
 * one-time file header when absent. A raw write (may reject); the caller
 * decides best-effort.
 */
export async function appendLog(cwd: string, entry: LogEntry, fs: StoreFs = nodeStoreFs()): Promise<void> {
  await fs.mkdir(join(cwd, THE_FRAMEWORK_DIR))
  const path = logsPath(cwd)
  if (!(await fs.exists(path))) await fs.write(path, LOGS_HEADER)
  await fs.append(path, '\n' + renderLogEntry(entry) + '\n')
}

/** Read the project log, newest-first (append order reversed). Missing file yields `[]`. */
export async function readLogs(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<LogEntry[]> {
  const path = logsPath(cwd)
  if (!(await fs.exists(path))) return []
  return parseLogs(await fs.read(path)).reverse()
}
