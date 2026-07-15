import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compile `prompts/**/*.md` (#551) into `src/prompts.generated.ts` so the prompting is
// authored as markdown while the code keeps importing plain strings.
//
// Why generate instead of reading the .md at run time (the @gemstack/ai-autopilot pattern):
// the system prompt and every preset are reachable from `src/client.ts`, which the dashboard
// imports in the *browser* to show the prompt before a run (#520). A `node:fs` read there
// breaks the browser bundle, and `client.test.ts` fails the build over it. A generated module
// is just strings, so it crosses that boundary for free and the package stays `files: ["dist"]`.
//
// The .md is the only source of truth; the generated file is git-ignored and rebuilt by
// `build` / `test` / `typecheck`, so it cannot drift the way the hand-copied template did.

const here = dirname(fileURLToPath(import.meta.url))
const promptsDir = join(here, '..', 'prompts')
const outFile = join(here, '..', 'src', 'prompts.generated.ts')

/**
 * Every prompt .md under prompts/, as absolute paths, sorted so the output is stable.
 * README.md is documentation for humans, not a prompt.
 */
async function findMarkdown(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await findMarkdown(path)))
    else if (entry.name.endsWith('.md') && entry.name !== 'README.md') found.push(path)
  }
  return found.sort()
}

/** `presets/security_audit.md` -> `PRESETS_SECURITY_AUDIT`. */
function constName(relPath) {
  return relPath
    .replace(/\.md$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
}

const files = await findMarkdown(promptsDir)
const entries = await Promise.all(
  files.map(async path => {
    const relPath = relative(promptsDir, path).split('\\').join('/')
    const raw = await readFile(path, 'utf8')
    // Strip exactly one trailing newline: the files end with one so they are well-formed on
    // disk, the prompts they carry do not.
    return { relPath, name: constName(relPath), text: raw.replace(/\n$/, '') }
  }),
)

const body = entries
  // JSON.stringify, not a template literal: the prompts contain backticks and `${{ }}`
  // fragments, and hand-rolled escaping is exactly the kind of thing that silently corrupts
  // a prompt. Unreadable output is fine, nobody reads this file.
  .map(e => `/** \`prompts/${e.relPath}\` */\nexport const ${e.name} = ${JSON.stringify(e.text)}\n`)
  .join('\n')

const out = `// Generated from prompts/**/*.md by scripts/gen-prompts.mjs. Do not edit.
// Edit the markdown instead; this file is rebuilt on every build/test/typecheck.

${body}`

await writeFile(outFile, out)
console.log(`[gen-prompts] ${entries.length} prompts -> ${relative(join(here, '..'), outFile)}`)
