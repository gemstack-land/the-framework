#!/usr/bin/env node
// Live benchmark for the architect prompt (#485/#499): run a labeled corpus of app ideas
// through the architect and report whether it picks sane stacks, gives honest tradeoffs,
// and stays framework-balanced on agnostic web apps. Requires the `claude` CLI logged in.
//
//   pnpm --filter @gemstack/framework build
//   pnpm --filter @gemstack/framework bench:architect
//   MODEL=claude-haiku-4-5-20251001 pnpm --filter @gemstack/framework bench:architect
//
// Scoring lives in src/architect-bench.ts (unit-tested); this is just the live runner.
import { ClaudeCodeDriver } from '../dist/index.js'
import {
  ARCHITECT_BENCH_CASES,
  formatArchitectBenchReport,
  runArchitectBench,
} from '../dist/architect-bench.js'

const driver = new ClaudeCodeDriver({ permissionMode: 'acceptEdits' })

console.log(`Running ${ARCHITECT_BENCH_CASES.length} architect cases...\n`)

const report = await runArchitectBench({
  driver,
  cases: ARCHITECT_BENCH_CASES,
  cwd: process.cwd(),
  ...(process.env.MODEL ? { model: process.env.MODEL } : {}),
  onResult: (r, i) => {
    const tag = r.case.webAgnostic ? `bal:${r.framework}` : r.stackFit ? 'ok ' : 'XX '
    const flags = `${r.complete ? '' : ' [no tradeoffs]'}`
    console.log(`${tag.padEnd(12)} ${String(i + 1).padStart(2)}. ${r.stack}${flags}  <- ${r.case.intent}`)
  },
})

console.log(`\n${formatArchitectBenchReport(report)}`)
