import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudflareTarget, type DeployExecutor } from './cloudflare.js'
import type { ExecOptions, ExecResult } from '../runner/types.js'
import type { DeployPlan, DeployTargetContext } from './types.js'

interface Call {
  command: string
  opts?: ExecOptions
}

/** A fake executor: records commands and returns canned results (by matching a substring). */
function fakeExec(responses: Array<{ match: string; result: Partial<ExecResult> }>): DeployExecutor & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
      calls.push({ command, ...(opts ? { opts } : {}) })
      const hit = responses.find((r) => command.includes(r.match))
      return { stdout: '', stderr: '', exitCode: 0, ...(hit?.result ?? {}) }
    },
  }
}

function ctxFor(render: DeployPlan['render']): DeployTargetContext {
  return { plan: { render, target: 'cloudflare', reason: 'test' }, intent: 'an app' }
}

const OK: Array<{ match: string; result: Partial<ExecResult> }> = [
  { match: 'wrangler deploy', result: { stdout: 'Published orders-app\nhttps://orders-app.acme.workers.dev' } },
  { match: 'wrangler pages deploy', result: { stdout: 'Success!\nTake a peek: https://abc123.orders-app.pages.dev' } },
]

test('SSR ships to Workers and returns the workers.dev URL', async () => {
  const exec = fakeExec(OK)
  const target = cloudflareTarget({ session: exec, apiToken: 'tok', accountId: 'acct' })
  const res = await target.deploy(ctxFor('ssr'))
  assert.equal(res.deployed, true)
  assert.equal(res.url, 'https://orders-app.acme.workers.dev')
  const commands = exec.calls.map((c) => c.command)
  assert.deepEqual(commands, ['npm install', 'npm run build', 'npx wrangler deploy'])
  // credentials are passed to wrangler via the command env, not to install/build
  assert.deepEqual(exec.calls[2]!.opts?.env, { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acct' })
  assert.equal(exec.calls[0]!.opts?.env, undefined)
})

test('SSG ships to Pages with the project name and returns the pages.dev URL', async () => {
  const exec = fakeExec(OK)
  const target = cloudflareTarget({ session: exec, apiToken: 'tok', projectName: 'orders-app' })
  const res = await target.deploy(ctxFor('ssg'))
  assert.equal(res.deployed, true)
  assert.equal(res.url, 'https://abc123.orders-app.pages.dev')
  assert.equal(
    exec.calls.at(-1)!.command,
    'npx wrangler pages deploy dist/client --project-name orders-app',
  )
})

test('a Pages deploy without a project name does not run wrangler', async () => {
  const exec = fakeExec(OK)
  const target = cloudflareTarget({ session: exec, apiToken: 'tok' })
  const res = await target.deploy(ctxFor('spa'))
  assert.equal(res.deployed, false)
  assert.match(res.detail ?? '', /project name/)
  assert.equal(exec.calls.some((c) => c.command.includes('wrangler')), false)
})

test('a missing API token short-circuits before any command runs', async () => {
  const saved = process.env.CLOUDFLARE_API_TOKEN
  delete process.env.CLOUDFLARE_API_TOKEN
  try {
    const exec = fakeExec(OK)
    const res = await cloudflareTarget({ session: exec }).deploy(ctxFor('ssr'))
    assert.equal(res.deployed, false)
    assert.match(res.detail ?? '', /CLOUDFLARE_API_TOKEN/)
    assert.equal(exec.calls.length, 0)
  } finally {
    if (saved !== undefined) process.env.CLOUDFLARE_API_TOKEN = saved
  }
})

test('the API token falls back to the environment', async () => {
  const saved = process.env.CLOUDFLARE_API_TOKEN
  process.env.CLOUDFLARE_API_TOKEN = 'env-tok'
  try {
    const exec = fakeExec(OK)
    const res = await cloudflareTarget({ session: exec }).deploy(ctxFor('ssr'))
    assert.equal(res.deployed, true)
    assert.equal(exec.calls.at(-1)!.opts?.env?.CLOUDFLARE_API_TOKEN, 'env-tok')
  } finally {
    if (saved === undefined) delete process.env.CLOUDFLARE_API_TOKEN
    else process.env.CLOUDFLARE_API_TOKEN = saved
  }
})

test('a build failure reports the blocker and skips wrangler', async () => {
  const exec = fakeExec([{ match: 'npm run build', result: { exitCode: 1, stderr: 'type error in +Page.tsx' } }])
  const res = await cloudflareTarget({ session: exec, apiToken: 'tok' }).deploy(ctxFor('ssr'))
  assert.equal(res.deployed, false)
  assert.match(res.detail ?? '', /build failed/)
  assert.match(res.detail ?? '', /type error/)
  assert.equal(exec.calls.some((c) => c.command.includes('wrangler')), false)
})

test('a wrangler failure surfaces its stderr', async () => {
  const exec = fakeExec([{ match: 'wrangler deploy', result: { exitCode: 1, stderr: 'Authentication error [code: 10000]' } }])
  const res = await cloudflareTarget({ session: exec, apiToken: 'tok' }).deploy(ctxFor('ssr'))
  assert.equal(res.deployed, false)
  assert.match(res.detail ?? '', /wrangler failed/)
  assert.match(res.detail ?? '', /Authentication error/)
})

test('install and build can be skipped when already built', async () => {
  const exec = fakeExec(OK)
  const target = cloudflareTarget({ session: exec, apiToken: 'tok', installCommand: false, buildCommand: false })
  await target.deploy(ctxFor('ssr'))
  assert.deepEqual(exec.calls.map((c) => c.command), ['npx wrangler deploy'])
})

test('product override forces Pages for an SSR plan', async () => {
  const exec = fakeExec(OK)
  const target = cloudflareTarget({ session: exec, apiToken: 'tok', projectName: 'app', product: 'pages' })
  await target.deploy(ctxFor('ssr'))
  assert.match(exec.calls.at(-1)!.command, /wrangler pages deploy/)
})

test('a clean deploy with no URL in output still reports deployed', async () => {
  const exec = fakeExec([{ match: 'wrangler deploy', result: { stdout: 'done, no url here' } }])
  const res = await cloudflareTarget({ session: exec, apiToken: 'tok', installCommand: false, buildCommand: false }).deploy(ctxFor('ssr'))
  assert.equal(res.deployed, true)
  assert.equal(res.url, undefined)
  assert.match(res.detail ?? '', /no URL/)
})
