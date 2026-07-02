import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DecisionLedger } from './ledger.js'
import { loadLedger, saveLedger, DECISIONS_FILE, type LedgerFs } from './store.js'

/** An in-memory {@link LedgerFs} for tests (also proves the RunnerFs-shaped seam). */
function memFs(seed: Record<string, string> = {}): LedgerFs & { files: Record<string, string> } {
  const files = { ...seed }
  return {
    files,
    async read(path) {
      const v = files[path]
      if (v === undefined) throw new Error(`ENOENT: ${path}`)
      return v
    },
    async write(path, contents) {
      files[path] = contents
    },
    async exists(path) {
      return path in files
    },
  }
}

describe('decisions store', () => {
  it('returns an empty ledger when the file is absent', async () => {
    const ledger = await loadLedger(memFs())
    assert.equal(ledger.size, 0)
  })

  it('saves to DECISIONS.md and loads back an equivalent ledger', async () => {
    const fs = memFs()
    const ledger = new DecisionLedger()
    ledger.reject('Use Redux', 'boilerplate', ['state'])
    await saveLedger(fs, ledger)

    assert.ok(fs.files[DECISIONS_FILE])
    const loaded = await loadLedger(fs)
    assert.equal(loaded.get('use-redux')?.rationale, 'boilerplate')
    assert.equal(loaded.wasRejected('add redux'), true)
  })

  it('honors a custom path', async () => {
    const fs = memFs()
    await saveLedger(fs, new DecisionLedger([]), 'docs/DECISIONS.md')
    assert.ok('docs/DECISIONS.md' in fs.files)
  })
})
