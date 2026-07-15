import { runCapstone, INTENT } from './bootstrap.js'

/** Run the capstone and print what each phase and surface exposed. Offline (AiFake). */
async function main(): Promise<void> {
  console.log(`Bootstrap: "${INTENT}"\n`)
  console.log('--- live narration (surface stream) ---')
  const { detection, result, files, overview } = await runCapstone(line => process.stdout.write(line + '\n'))

  console.log('\n--- preset ---')
  console.log(`  detected: ${detection.framework} (confidence ${detection.confidence})`)

  console.log('\n--- app scaffolded (runner sandbox) ---')
  for (const path of Object.keys(files).sort()) console.log(`  ${path}`)

  console.log('\n--- outcome ---')
  console.log(`  scope: ${result.scope}`)
  console.log(`  production-grade: ${result.productionGrade} (after ${result.passes} checklist pass(es))`)
  console.log(`  deploy: ${result.deploy?.plan.render.toUpperCase()} → ${result.deploy?.plan.target}, url ${result.deploy?.result.url}`)

  console.log('\n--- scale mode: CODE-OVERVIEW.md ---')
  console.log(`  ${overview?.summary}`)
  for (const s of overview?.sections ?? []) console.log(`  ## ${s.title}`)
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
