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
 *
 * An allow-list, so anything else meant to be committed needs its own negation —
 * see `CONVERSATIONS_GITIGNORE` (#908), which install appends to this.
 */
export const LOGS_GITIGNORE =
  '# The Framework: the committed project DB; session state is transient.\n*\n!.gitignore\n!LOGS.md\n'

/** One project-log entry: a loop, or a standalone prompt/build. */
export interface LogEntry {
  /** ISO timestamp. */
  at: string
  kind: 'loop' | 'prompt' | 'build'
  /** The run's intent/prompt. Escaped to one line on write (#897), so it may hold a whole prompt. */
  title: string
  status: 'done' | 'stopped' | 'failed' | 'running'
  /**
   * The run's id (#898): the join key from this committed entry to the rest of the run, whose
   * `runs/<id>.json` meta and `runs/<id>.jsonl` events are transient and stay out of git.
   */
  id?: string
  /** Claude Code session id. */
  sessionId?: string
  /** e.g. `https://claude.ai/code/<id>` */
  sessionLink?: string
  /** The name the agent gave the session (#326), also its `the-framework/<name>` branch. */
  sessionName?: string
  /**
   * The branch the run's work landed on (#799). Read from the checkout as the run settles,
   * because it is not derivable later: a clean run loses its worktree, and the agent may have
   * branched itself.
   */
  branch?: string
  /** For a loop: constituent prompt summaries. */
  prompts?: string[]
}

const KINDS: readonly string[] = ['loop', 'prompt', 'build']
const STATUSES: readonly string[] = ['done', 'stopped', 'failed', 'running']

/** Heading field separator: a middle dot (U+00B7) with a space on each side. */
const SEP = ' · '

/**
 * Escape a free-text field so it stays on its own line (#897). A title is the run's prompt and a
 * prompt bullet is agent text, but the file is committed history parsed line by line: an unescaped
 * newline spills the rest of the prompt into the file, where a `## ` line forges an entry and a
 * `- status: ` line rewrites one. Reversed by {@link decodeField}.
 */
export function encodeField(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
}

/** Reverse {@link encodeField}. Entries written before #897 are unescaped, so a literal `\n` in
 * one of them decodes to a newline; harmless next to reading the rest of the prompt as entries. */
export function decodeField(value: string): string {
  return value.replace(/\\(\\|n)/g, (_, char) => (char === 'n' ? '\n' : '\\'))
}

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
    `## ${entry.at}${SEP}${entry.kind}${SEP}${encodeField(entry.title)}`,
    '',
    `- status: ${entry.status}`,
  ]
  if (entry.id) lines.push(`- run: ${encodeField(entry.id)}`)
  if (entry.sessionId) {
    lines.push(
      entry.sessionLink
        ? `- session: [${entry.sessionId}](${entry.sessionLink})`
        : `- session: ${entry.sessionId}`,
    )
  }
  if (entry.sessionName) lines.push(`- name: ${encodeField(entry.sessionName)}`)
  if (entry.branch) lines.push(`- branch: ${encodeField(entry.branch)}`)
  if (entry.prompts && entry.prompts.length > 0) {
    lines.push('- prompts:')
    for (const prompt of entry.prompts) lines.push(`  - ${encodeField(prompt)}`)
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
  const title = decodeField(parts.slice(2).join(SEP))
  if (!at || !kind || !title || !KINDS.includes(kind)) return undefined

  let status: string | undefined
  let id: string | undefined
  let sessionId: string | undefined
  let sessionLink: string | undefined
  let sessionName: string | undefined
  let branch: string | undefined
  let prompts: string[] | undefined
  let inPrompts = false
  for (const line of lines.slice(1)) {
    if (inPrompts && line.startsWith('  - ')) {
      prompts!.push(decodeField(line.slice('  - '.length)))
      continue
    }
    inPrompts = false
    if (line.startsWith('- status: ')) {
      status = line.slice('- status: '.length).trim()
    } else if (line.startsWith('- run: ')) {
      id = decodeField(line.slice('- run: '.length).trim())
    } else if (line.startsWith('- name: ')) {
      sessionName = decodeField(line.slice('- name: '.length).trim())
    } else if (line.startsWith('- branch: ')) {
      branch = decodeField(line.slice('- branch: '.length).trim())
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
  if (id) entry.id = id
  if (sessionId) entry.sessionId = sessionId
  if (sessionLink) entry.sessionLink = sessionLink
  if (sessionName) entry.sessionName = sessionName
  if (branch) entry.branch = branch
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
