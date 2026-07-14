#!/usr/bin/env node
// Live benchmark for the meta-select routing step (#502): run the hand-labeled corpus
// through a real model and print how well it routes. Requires the `claude` CLI logged in.
//
//   pnpm --filter @gemstack/framework build   # first, so dist/ exists
//   pnpm --filter @gemstack/framework bench:meta-select
//   MODEL=claude-haiku-4-5-20251001 pnpm --filter @gemstack/framework bench:meta-select
//
// The scoring lives in src/meta-select-bench.ts (unit-tested); this is just the live runner.
import { ClaudeCodeDriver } from '../dist/index.js'
import {
  META_SELECT_BENCH_CASES,
  formatMetaSelectBenchReport,
  runMetaSelectBench,
} from '../dist/meta-select-bench.js'
import { presetCatalog } from '../dist/meta-select.js'
import { builtinDomainPresets } from '@gemstack/ai-autopilot'

const presets = await builtinDomainPresets()
const catalog = presetCatalog(presets)
const driver = new ClaudeCodeDriver({ permissionMode: 'acceptEdits' })

console.log(`Running ${META_SELECT_BENCH_CASES.length} meta-select cases against ${catalog.length} presets...\n`)

const report = await runMetaSelectBench({
  driver,
  cases: META_SELECT_BENCH_CASES,
  catalog,
  cwd: process.cwd(),
  ...(process.env.MODEL ? { model: process.env.MODEL } : {}),
  onResult: (r, i) => {
    const mark = r.correct ? 'ok ' : 'XX '
    console.log(`${mark}${String(i + 1).padStart(2)}. [${r.case.expected} -> ${r.picked}] ${r.case.intent}`)
  },
})

console.log(`\n${formatMetaSelectBenchReport(report)}`)
