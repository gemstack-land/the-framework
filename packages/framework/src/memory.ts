import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A canonical repo memory file (#204, #260): a special file at the workspace root
 * the agent reads at the start of a run for context and keeps current as it works,
 * so the project's memory lives in the repo as plain markdown (Rom's idea). This
 * doubles as persistence: the next run picks up where the last left off.
 */
export interface MemoryFile {
  /** File name at the workspace root. */
  name: string
  /** What it holds, shown to the agent so it knows what belongs where. */
  purpose: string
  /**
   * False when The Framework owns the file and the agent must not edit it (it may
   * still read it for context). `DECISIONS.md` is written from our decisions
   * ledger at run end, so an agent edit would be clobbered. Default `true`.
   */
  agentMaintained?: boolean
}

/** The canonical repo memory files, in the order they are framed. */
export const MEMORY_FILES: readonly MemoryFile[] = [
  { name: 'CODE-OVERVIEW.md', purpose: 'a map of the codebase: structure, key modules, and how they fit together' },
  { name: 'KNOWLEDGE-BASE.md', purpose: 'durable facts and conventions learned about this project' },
  { name: 'BRAINSTORMING.md', purpose: 'open ideas and things to explore later' },
  // Framework-owned: written from the decisions ledger at run end. Read-only to the agent.
  { name: 'DECISIONS.md', purpose: 'the running log of decisions and why', agentMaintained: false },
]

/** A memory file paired with its current contents. */
export interface LoadedMemory extends MemoryFile {
  /** Current file contents (trimmed), or undefined when the file does not exist yet. */
  content?: string
}

/**
 * Read the canonical memory files present in a workspace. Every entry comes back
 * (so the agent is told to create the missing ones); a file that does not exist
 * yet simply has no `content`.
 */
export async function loadRepoMemory(
  dir: string,
  files: readonly MemoryFile[] = MEMORY_FILES,
): Promise<LoadedMemory[]> {
  return Promise.all(
    files.map(async file => {
      try {
        const content = (await readFile(join(dir, file.name), 'utf8')).trim()
        return content ? { ...file, content } : { ...file }
      } catch {
        return { ...file }
      }
    }),
  )
}

/**
 * Build the system-prompt block that turns the repo's special files into the
 * agent's persistent memory: the current contents of any files present (so the
 * agent starts with that context), plus an instruction to keep the ones it owns
 * current. Returns `''` when there is nothing to frame.
 */
export function memoryFraming(memories: readonly LoadedMemory[]): string {
  if (memories.length === 0) return ''
  const owned = memories.filter(m => m.agentMaintained !== false)
  const framework = memories.filter(m => m.agentMaintained === false)
  const present = memories.filter(m => m.content)

  const lines: string[] = ['## Project memory']
  lines.push(
    "This project keeps its long-term memory in these files at the repo root. Read them for context before you start.",
  )
  if (owned.length) {
    lines.push('\nKeep these up to date as you work, creating one when it does not exist yet:')
    for (const m of owned) lines.push(`- ${m.name}: ${m.purpose}`)
  }
  if (framework.length) {
    lines.push('\nRead-only (The Framework writes these, do not edit them):')
    for (const m of framework) lines.push(`- ${m.name}: ${m.purpose}`)
  }
  if (present.length) {
    lines.push('\nCurrent contents:')
    for (const m of present) lines.push(`\n### ${m.name}\n${m.content}`)
  } else {
    lines.push('\nNone exist yet. Start them as you learn about the project.')
  }
  return lines.join('\n')
}
