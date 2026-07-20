import { join } from 'node:path'
import { THE_FRAMEWORK_DIR } from './framework-dir.js'
import { gitignorePath, LOGS_GITIGNORE } from './logs.js'
import { isSafeRunId, nodeStoreFs, type StoreFs } from './store/index.js'

/**
 * The committed conversations (#908): the human turns and the agent's replies of a run, kept in
 * the Git repo so a clone carries the chat and not just the fact a run happened (#857).
 *
 * Deliberately not the verbose transcript — #857 leaves the tool-call-level log to the model
 * provider, which is also the standing policy in run-store.ts. What lands here is what a person
 * would reread: what was asked, and what came back.
 *
 * One file per run rather than one shared file, because run worktrees are live concurrently and
 * each auto-commits its own pending work on teardown; a shared file would be a merge conflict
 * every time two runs chatted at once. The run id is the join key back to the `- run:` field
 * LOGS.md records (#898), so the committed session list and the committed chat line up.
 *
 * Pure core over the same {@link StoreFs} seam as logs.ts.
 */

/** The directory, under `.the-framework/`, that holds one markdown file per conversation. */
export const CONVERSATIONS_DIR = 'conversations'

/**
 * The `.the-framework/.gitignore` that keeps run state transient while committing the DB. The
 * conversations rules need both entries: the `*` rule makes git skip the directory without ever
 * descending into it, so un-ignoring the files alone would never be reached.
 */
export const CONVERSATIONS_GITIGNORE = `!${CONVERSATIONS_DIR}/\n!${CONVERSATIONS_DIR}/**\n`

/** Who said it. The transport is {@link ConversationMessage.via}, not this. */
export type ConversationRole = 'user' | 'agent'

/** One turn in a conversation. */
export interface ConversationMessage {
  /** ISO timestamp. */
  at: string
  role: ConversationRole
  /**
   * The surface the turn came through — `dashboard`, `discord`, … Recorded so a conversation
   * read back shows where it happened, while this module stays free of any transport.
   */
  via: string
  /** The message. Multi-line and kept that way; only line-leading markers are escaped. */
  text: string
}

const ROLES: readonly string[] = ['user', 'agent']

/** Heading field separator, matching LOGS.md: a middle dot (U+00B7) with a space on each side. */
const SEP = ' · '

/** A transport name is a plain word, so it can never carry the heading separator into a heading. */
const VIA = /^[A-Za-z0-9_-]+$/

/**
 * Escape a message body so it cannot forge structure (#897's threat model, applied to a
 * transcript). LOGS.md collapses free text to one line, which is right for a line-parsed record
 * and wrong here: a multi-paragraph reply has to stay readable in a `git diff`. So the text stays
 * as written and only a line's leading `#` or `\` is escaped, which is enough — an entry is only
 * ever started by a line beginning `## `. Reversed by {@link unescapeBody}.
 */
export function escapeBody(text: string): string {
  return text.replace(/^([\\#])/gm, '\\$1')
}

/** Reverse {@link escapeBody}. */
export function unescapeBody(text: string): string {
  return text.replace(/^\\([\\#])/gm, '$1')
}

/** The one-time first line of a conversation file. */
export function conversationHeader(runId: string): string {
  return `# Conversation ${runId}\n`
}

/** The directory holding every conversation under `cwd`. */
export function conversationsDir(cwd: string): string {
  return join(cwd, THE_FRAMEWORK_DIR, CONVERSATIONS_DIR)
}

/**
 * One conversation's path. `undefined` for an unsafe run id: the id reaches this from a run
 * store and, once #680 lands, indirectly from a chat surface, so it is checked rather than
 * trusted into a path.
 */
export function conversationPath(cwd: string, runId: string): string | undefined {
  if (!isSafeRunId(runId)) return undefined
  return join(conversationsDir(cwd), `${runId}.md`)
}

/** Markdown for one message, starting at `## ` (no file header, no blank lines around it). */
export function renderMessage(message: ConversationMessage): string {
  return `## ${message.at}${SEP}${message.role}${SEP}${message.via}\n\n${escapeBody(message.text)}`
}

/**
 * Parse every message out of the markdown, in file order (append order, so oldest-first — a
 * transcript reads forwards, unlike the newest-first project log). Forgiving: a malformed or
 * torn message is skipped, never thrown.
 */
export function parseConversation(md: string): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  let block: string[] | undefined
  const flush = () => {
    const message = block && parseMessage(block)
    if (message) messages.push(message)
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
  return messages
}

/** Parse one `## `-headed block; `undefined` when a required field is missing/invalid. */
function parseMessage(lines: string[]): ConversationMessage | undefined {
  const heading = lines[0]?.slice('## '.length) ?? ''
  const parts = heading.split(SEP)
  const at = parts[0]
  const role = parts[1]
  const via = parts[2]
  if (!at || !role || !via || !ROLES.includes(role) || !VIA.test(via)) return undefined
  // A heading carries exactly three fields; anything more is not one of ours.
  if (parts.length !== 3) return undefined

  // Drop the blank line the renderer puts under the heading, and any trailing blank lines that
  // are really the separator before the next message.
  const body = lines.slice(1).join('\n').replace(/^\n/, '').replace(/\n+$/, '')

  return { at, role: role as ConversationRole, via, text: unescapeBody(body) }
}

/**
 * Make sure `.the-framework/.gitignore` un-ignores the conversations dir, returning whether it
 * wrote. Done lazily on append rather than only at install time: the seeded ignore file is
 * written once and only when absent (`install.ts`), so every repo activated before this feature
 * still carries the old three-line allow-list and would silently drop its own conversations.
 *
 * Only ours is upgraded — a file we do not recognize is left alone rather than appended to.
 */
export async function ensureConversationsIgnored(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<boolean> {
  const path = gitignorePath(cwd)
  if (!(await fs.exists(path))) {
    await fs.write(path, LOGS_GITIGNORE + CONVERSATIONS_GITIGNORE)
    return true
  }
  const current = await fs.read(path)
  if (current.includes(`!${CONVERSATIONS_DIR}/**`)) return false
  if (!current.includes('!LOGS.md')) return false
  await fs.write(path, current.endsWith('\n') ? current + CONVERSATIONS_GITIGNORE : current + '\n' + CONVERSATIONS_GITIGNORE)
  return true
}

/**
 * Append one message to `.the-framework/conversations/<runId>.md`, creating the dir, the
 * one-time file header, and the ignore rule when absent. A raw write (may reject); the caller
 * decides best-effort. A no-op for an unsafe run id.
 */
export async function appendMessage(
  cwd: string,
  runId: string,
  message: ConversationMessage,
  fs: StoreFs = nodeStoreFs(),
): Promise<void> {
  const path = conversationPath(cwd, runId)
  if (!path) return
  await fs.mkdir(conversationsDir(cwd))
  await ensureConversationsIgnored(cwd, fs)
  if (!(await fs.exists(path))) await fs.write(path, conversationHeader(runId))
  await fs.append(path, '\n' + renderMessage(message) + '\n')
}

/** Read one conversation, oldest-first. Missing file (or unsafe id) yields `[]`. */
export async function readConversation(
  cwd: string,
  runId: string,
  fs: StoreFs = nodeStoreFs(),
): Promise<ConversationMessage[]> {
  const path = conversationPath(cwd, runId)
  if (!path || !(await fs.exists(path))) return []
  return parseConversation(await fs.read(path))
}

/** The run ids that have a committed conversation, sorted. Missing dir yields `[]`. */
export async function listConversations(cwd: string, fs: StoreFs = nodeStoreFs()): Promise<string[]> {
  const names = await fs.readdir(conversationsDir(cwd)).catch(() => [])
  return names
    .filter(name => name.endsWith('.md'))
    .map(name => name.slice(0, -'.md'.length))
    .filter(isSafeRunId)
    .sort()
}
