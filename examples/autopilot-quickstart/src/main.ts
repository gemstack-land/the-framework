import { runQuickstart, TASK } from './autopilot.js'

/** Run the quickstart and print what each surface exposed. Offline (AiFake). */
async function main(): Promise<void> {
  console.log(`Task: ${TASK}\n`)
  console.log('--- live progress (terminal surface) ---')
  const result = await runQuickstart(line => process.stdout.write(line + '\n'))

  console.log('\n--- files written into the sandbox (runner) ---')
  for (const path of Object.keys(result.files).sort()) console.log(`  ${path}`)

  console.log('\n--- build + preview (runner) ---')
  console.log(`  build: exit ${result.build.exitCode} — ${result.build.stdout}`)
  console.log(`  preview: ${result.previewUrl}`)

  console.log('\n--- synthesized result (Supervisor) ---')
  console.log(result.run.text.replace(/^/gm, '  '))
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
