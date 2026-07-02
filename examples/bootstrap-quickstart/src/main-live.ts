import { runLiveCapstone } from './live.js'
import { INTENT } from './bootstrap.js'

/** Run the LIVE capstone (real model + LocalRunner) and print what each phase produced.
 *  Needs ANTHROPIC_API_KEY in the environment (see live.ts). */
async function main(): Promise<void> {
  console.log(`Bootstrap (LIVE): "${INTENT}"\n`)
  console.log('--- live narration (surface stream) ---')
  const { detection, result, files, overview } = await runLiveCapstone(line => process.stdout.write(line + '\n'))

  console.log('\n--- preset ---')
  console.log(`  detected: ${detection.framework} (confidence ${detection.confidence})`)

  console.log('\n--- app scaffolded (REAL LocalRunner workspace) ---')
  for (const path of Object.keys(files).sort()) console.log(`  ${path} (${files[path]?.length ?? 0} bytes)`)

  console.log('\n--- outcome ---')
  console.log(`  scope: ${result.scope}`)
  console.log(`  production-grade: ${result.productionGrade} (after ${result.passes} checklist pass(es))`)
  console.log(`  deploy: ${result.deploy?.plan.render.toUpperCase()} → ${result.deploy?.plan.target}`)
  console.log(`  decisions recorded: ${result.plan.decisions.length}`)

  console.log('\n--- scale mode: CODE-OVERVIEW.md ---')
  console.log(`  ${overview?.summary}`)
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
