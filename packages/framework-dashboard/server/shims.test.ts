import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * #1014: telefunc's dev transform appends `__decorateTelefunction(<name>, ...)` for every
 * export in a `.telefunc.ts` file, which only resolves if the name is a local binding.
 * `export { x } from '...'` creates no local binding, so `pnpm dev` answered every RPC with
 * `ReferenceError: x is not defined`. Production never noticed, because the daemon registers
 * the telefunctions in-process and these files exist only to pin the baked RPC keys.
 *
 * Guarded here rather than in a running dev server: the failure needs vite plus telefunc plus
 * a real request, and the shape that causes it is visible in the source.
 */

const serverDir = dirname(fileURLToPath(import.meta.url))
const shims = readdirSync(serverDir).filter(f => f.endsWith('.telefunc.ts'))

/** `export { a, b } from 'x'` — the form that produces no local binding. */
const VALUE_REEXPORT = /export\s*\{[^}]*\}\s*from\s*['"]/g

function namesIn(block: string): string[] {
  return block
    .split(',')
    .map(n => n.trim().split(/\s+as\s+/).pop()!.trim())
    .filter(Boolean)
}

describe('telefunc shims (#1014)', () => {
  it('finds the shim files', () => {
    expect(shims.length).toBeGreaterThan(0)
  })

  for (const file of shims) {
    const src = readFileSync(join(serverDir, file), 'utf8')

    it(`${file} does not re-export values with \`export ... from\``, () => {
      // `export type { ... } from` is fine: types are erased before the transform runs.
      const withoutTypeExports = src.replace(/export\s+type\s*\{[^}]*\}\s*from\s*['"][^'"]*['"]/g, '')

      expect(withoutTypeExports.match(VALUE_REEXPORT)).toBeNull()
    })

    it(`${file} exports exactly the names it imports`, () => {
      const imported = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g)]
        .flatMap(m => namesIn(m[1]!))
      const exported = [...src.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)]
        .flatMap(m => namesIn(m[1]!))

      expect(exported.length).toBeGreaterThan(0)
      expect([...exported].sort()).toEqual([...imported].sort())
    })
  }
})
