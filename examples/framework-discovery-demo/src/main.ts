import { DEMO_INTENT, runDemo } from './demo.js'

/** Run the discovery proof and print the story: live narration, then the outcome. */
async function main(): Promise<void> {
  console.log('The Framework — third-party extension discovery (offline, deterministic)\n')
  console.log(`Prompt:  "${DEMO_INTENT}"\n`)
  console.log('--- live narration ---')
  const out = await runDemo(line => console.log(line))

  console.log('\n--- outcome ---')
  console.log(`  discovered:        ${out.discovered.join(', ') || '(none)'}`)
  console.log(`  framework:         ${out.framework ?? 'Vike (default)'}`)
  console.log(`  greeter persona:   ${out.greeterComposed ? 'composed into the frame' : 'MISSING'}`)
  console.log(`  hello-guide skill: ${out.helloSkillComposed ? 'composed into the frame' : 'MISSING'}`)
  console.log(`  production-grade:  ${out.productionGrade}`)

  console.log('\nframework-hello is a plain third-party package. The framework core never')
  console.log('mentions it — installing it into this project is the whole integration.')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
