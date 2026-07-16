import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fail when the prompting in `prompts/` no longer matches the #326 issue, which is where the
// system prompt is designed and reviewed ("change it there first").
//
// Why this exists: the system prompt was rewritten on the issue on 2026-07-13 and the repo was
// only synced on 2026-07-15. Nothing noticed for two days. `gen-prompts.mjs` guards the
// .md -> .ts direction; this guards the direction that actually broke, issue -> .md.
//
// The two blocks are checked differently, because only one of them can ever match byte-for-byte:
//   - Block 1 (`## System prompt`) ships verbatim, so `prompts/system_prompt.md` IS the copy to
//     compare against. Any difference is drift, in either direction.
//   - Block 2 (`## Post-merge prompt`) cannot ship verbatim: it nests a `${{ }}` fragment inside
//     another one, which the renderer cannot parse, so what ships is a flattened equivalent.
//     There is nothing to byte-compare, so instead we snapshot the block and fail when it
//     changes: that means the design moved and a human has to re-flatten it.

const here = dirname(fileURLToPath(import.meta.url))
const systemPromptFile = join(here, '..', 'prompts', 'system_prompt.md')
const snapshotFile = join(here, 'op-326-on-before-mergeable.snapshot.md')

const REPO = 'gemstack-land/gemstack'
const ISSUE = 326

/** The ```md blocks of the issue body, in order. Block 1 = system prompt, block 2 = on-before-mergeable. */
function extractPromptBlocks(body) {
  return [...body.matchAll(/```md\n([\s\S]*?)\n```/g)].map(m => m[1])
}

/** Compare ignoring only trailing whitespace: the files on disk end with a newline, the blocks don't. */
const normalize = text => text.replace(/\s+$/, '')

/** The first line that differs, so a failure points at the change instead of just announcing one. */
function firstDifference(a, b, labelA, labelB) {
  const left = a.split('\n')
  const right = b.split('\n')
  const pad = Math.max(labelA.length, labelB.length)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      const show = (label, line) => `${label.padEnd(pad)}  ${JSON.stringify(line ?? '(ends here)')}`
      return `line ${i + 1}:\n  ${show(labelA, left[i])}\n  ${show(labelB, right[i])}`
    }
  }
  return '(no line differs; trailing whitespace only)'
}

async function fetchIssueBody() {
  const url = `https://api.github.com/repos/${REPO}/issues/${ISSUE}`
  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  let response
  try {
    response = await fetch(url, { headers })
  } catch (cause) {
    // GitHub being unreachable is not drift. Skip rather than wedge a PR on someone else's outage.
    throw new SkipError(`could not reach the GitHub API: ${cause.message}`)
  }
  if (response.status >= 500) throw new SkipError(`GitHub API returned ${response.status}`)
  // A 401/403/404 is our own misconfiguration, and silently passing would make the check a no-op.
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${url}`)
  return (await response.json()).body
}

class SkipError extends Error {}

async function main() {
  const update = process.argv.includes('--update')
  const body = await fetchIssueBody()
  const blocks = extractPromptBlocks(body)
  if (blocks.length !== 2) {
    throw new Error(
      `expected 2 \`\`\`md blocks in ${REPO}#${ISSUE}, found ${blocks.length}. ` +
        `The issue's structure changed; this check needs updating along with it.`,
    )
  }
  const [systemBlock, onBeforeMergeableBlock] = blocks.map(normalize)

  if (update) {
    await writeFile(snapshotFile, `${onBeforeMergeableBlock}\n`)
    console.log(`Updated ${snapshotFile} to the current #${ISSUE} on-before-mergeable block.`)
    return
  }

  const failures = []

  const shipped = normalize(await readFile(systemPromptFile, 'utf8'))
  if (systemBlock !== shipped) {
    failures.push(
      `prompts/system_prompt.md has drifted from ${REPO}#${ISSUE} (block 1).\n` +
        `  issue: ${systemBlock.length} chars, repo: ${shipped.length} chars\n` +
        `  first difference at ${firstDifference(systemBlock, shipped, 'issue:', 'repo:')}\n` +
        `  The issue is the source of truth: copy the block into prompts/system_prompt.md.`,
    )
  }

  const snapshot = normalize(await readFile(snapshotFile, 'utf8'))
  if (onBeforeMergeableBlock !== snapshot) {
    failures.push(
      `The on-before-mergeable block (block 2) of ${REPO}#${ISSUE} changed since it was last reviewed.\n` +
        `  snapshot: ${snapshot.length} chars, issue: ${onBeforeMergeableBlock.length} chars\n` +
        `  first difference at ${firstDifference(onBeforeMergeableBlock, snapshot, 'issue:', 'snapshot:')}\n` +
        `  It cannot be copied verbatim (it nests \`\${{ }}\` fragments). Re-flatten it into\n` +
        `  prompts/on_before_mergeable_prompt.md, then run: pnpm --filter @gemstack/framework check:prompt-drift --update`,
    )
  }

  if (failures.length) {
    console.error(`\n${failures.join('\n\n')}\n`)
    process.exit(1)
  }
  console.log(`prompts/ is in sync with ${REPO}#${ISSUE} (block 1 ${systemBlock.length} chars, block 2 snapshot ${snapshot.length} chars).`)
}

main().catch(error => {
  if (error instanceof SkipError) {
    console.warn(`Skipping the prompt drift check: ${error.message}`)
    return
  }
  console.error(error.message)
  process.exit(1)
})
