import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compiled file lives in dist-test/, dist/ is its sibling under the package root.
const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')

/**
 * Files that must have ZERO Node-only static imports — these compose the runtime-agnostic
 * main entry of @gemstack/ai-sdk. Anything in src/node/ or src/server/ is exempt.
 */
const NODE_IMPORT_RE = /from ['"](node:|fs|path|os|crypto|child_process|fs\/promises|stream|buffer)['"]/

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node' || name.name === 'server') continue
    if (name.name.endsWith('.d.ts') || name.name.endsWith('.map')) continue
    const full = join(dir, name.name)
    const rel  = prefix ? `${prefix}/${name.name}` : name.name
    if (name.isDirectory()) {
      out.push(...listFiles(full, rel))
    } else if (name.name.endsWith('.js')) {
      out.push(rel)
    }
  }
  return out
}

test('main entry has no Node-only imports', () => {
  if (!existsSync(distDir)) {
    assert.fail(`dist/ not found at ${distDir} — run \`pnpm build\` first.`)
  }

  const offenders: string[] = []
  for (const rel of listFiles(distDir)) {
    const content = readFileSync(join(distDir, rel), 'utf8')
    const matches = content.match(NODE_IMPORT_RE)
    if (matches) offenders.push(`${rel}: ${matches[0]}`)
  }

  assert.equal(
    offenders.length,
    0,
    `These files in @gemstack/ai-sdk's main entry contain Node-only imports — move them to /node or /server:\n  ${offenders.join('\n  ')}`,
  )
})

test('/node and /server subpaths exist', () => {
  assert.ok(existsSync(join(distDir, 'node', 'index.js')),   'dist/node/index.js missing')
  assert.ok(existsSync(join(distDir, 'server', 'index.js')), 'dist/server/index.js missing')
})
