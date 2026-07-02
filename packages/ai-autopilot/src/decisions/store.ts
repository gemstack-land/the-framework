import { DecisionLedger } from './ledger.js'

/**
 * The slice of a filesystem the store needs. Deliberately a subset of the
 * runner's `RunnerFs`, so a booted {@link RunnerSession}'s `fs` satisfies it
 * directly — the ledger persists inside a sandbox the same way it does on the
 * host. {@link nodeLedgerFs} is the host adapter.
 */
export interface LedgerFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** Default location of the ledger file, at the project/workspace root. */
export const DECISIONS_FILE = 'DECISIONS.md'

/**
 * Load a {@link DecisionLedger} from `path`. A missing file yields an empty
 * ledger (the expected first-run state), so callers never branch on existence.
 */
export async function loadLedger(fs: LedgerFs, path: string = DECISIONS_FILE): Promise<DecisionLedger> {
  if (!(await fs.exists(path))) return new DecisionLedger()
  return DecisionLedger.fromMarkdown(await fs.read(path))
}

/** Persist a ledger to `path` as `DECISIONS.md`. */
export async function saveLedger(
  fs: LedgerFs,
  ledger: DecisionLedger,
  path: string = DECISIONS_FILE,
): Promise<void> {
  await fs.write(path, ledger.toMarkdown())
}

/**
 * A {@link LedgerFs} backed by the host filesystem (`node:fs/promises`). The
 * import is dynamic so the decisions core stays free of a hard `node:fs`
 * dependency — the ledger and its markdown work in any runtime; only this
 * adapter touches disk.
 */
export function nodeLedgerFs(): LedgerFs {
  return {
    async read(path) {
      const { readFile } = await import('node:fs/promises')
      return readFile(path, 'utf8')
    },
    async write(path, contents) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, contents, 'utf8')
    },
    async exists(path) {
      const { stat } = await import('node:fs/promises')
      try {
        return (await stat(path)).isFile()
      } catch {
        return false
      }
    },
  }
}
