import { DEMO_INTENT, runDemo } from './demo.js'

/** Run the demo and print the whole story: the live narration, then the outcome. */
async function main(): Promise<void> {
  console.log('The Framework — end-to-end demo (offline, deterministic)\n')
  console.log(`Prompt:  "${DEMO_INTENT}"\n`)
  console.log('--- live narration ---')
  const out = await runDemo(line => console.log(line))

  console.log('\n--- outcome ---')
  console.log(`  preset detected:  ${out.framework}`)
  console.log(`  production-grade: ${out.productionGrade} (in ${out.passes} pass(es))`)
  console.log(`  deployed to:      ${out.deployTarget} → ${out.deployUrl}`)
  console.log(`  running locally:  ${out.previewUrl}`)
  console.log(`  it served:        ${out.served.slice(0, 72)}${out.served.length > 72 ? '…' : ''}`)

  console.log('\nThat is the fake driver. To do it for real against Claude Code:')
  console.log('  npx @gemstack/framework "a paginated orders page with sign-in"')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
