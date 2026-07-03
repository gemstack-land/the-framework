import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { cloudflareTarget } from '@gemstack/ai-autopilot'
import {
  FAKE_DEPLOY,
  FAKE_INTENT,
  FAKE_SIGNALS,
  fakeDriver,
  formatFrameworkEvent,
  runFramework,
  type AppPreview,
} from '@gemstack/framework'

/**
 * The showable end-to-end demo for `@gemstack/framework`: one prompt taken all
 * the way to a *running, deployed* app, offline and deterministic.
 *
 * It drives the real product (`runFramework`) with the built-in **fake driver**
 * (no Claude Code, no model, no keys) so the whole flow — preset detection,
 * architect decisions, build, the full-fledged production-grade loop, and deploy
 * — runs the same code a live run does, just with scripted agent turns. Two
 * things are genuinely real, not narrated:
 *
 *  - the app **boots and serves**: the serve gate starts a real HTTP server and
 *    the run leaves it running, so the demo can `fetch` it and prove it works;
 *  - the **deploy** runs the real `cloudflareTarget` adapter over a simulated
 *    wrangler, so it ends at a real-looking `workers.dev` URL deterministically.
 *
 * This is the artifact to point people at (README / the-framework.ai / Discord):
 * a single command that goes from an idea to an app you can open.
 */

/** The one prompt the demo builds from. */
export const DEMO_INTENT = FAKE_INTENT

/** What {@link runDemo} reports back after the flow completes. */
export interface DemoOutcome {
  /** The detected framework preset (Vike, from the demo's deps signals). */
  framework: string | undefined
  /** Whether the loop reached production-grade, and in how many passes. */
  productionGrade: boolean
  passes: number
  /** The deploy result: the target and the (simulated) live URL. */
  deployTarget: string | undefined
  deployUrl: string | undefined
  /** The localhost URL the app was left running at. */
  previewUrl: string | undefined
  /** The first bytes the running app actually served (proof it works). */
  served: string
}

/** An ephemeral free port so the demo never collides with something already bound. */
function freePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const srv = createServer()
    srv.on('error', rejectPromise)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolvePromise(port))
    })
  })
}

/** The tiny but real "orders app" the serve gate boots — a stand-in for what the agent builds. */
function ordersAppSource(port: number): string {
  return [
    `const http = require('http')`,
    `const page = \`<!doctype html><meta charset=utf-8><title>Orders</title>`,
    `<h1>Orders</h1><table><tr><th>#</th><th>Customer</th><th>Total</th></tr>`,
    `<tr><td>1001</td><td>Ada Lovelace</td><td>$42.00</td></tr>`,
    `<tr><td>1002</td><td>Alan Turing</td><td>$17.50</td></tr></table>\``,
    `http.createServer((_, res) => res.end(page)).listen(${port})`,
  ].join('\n')
}

/** The simulated Cloudflare: every command succeeds; the deploy prints a workers.dev URL. */
const simulatedCloudflare = {
  exec: async (command: string) => ({
    stdout: /wrangler|deploy/.test(command)
      ? 'Published framework-demo\nhttps://orders-app.gemstack.workers.dev'
      : '',
    stderr: '',
    exitCode: 0,
  }),
}

/**
 * Run the whole demo and stream one narration line per phase to `onLine`.
 * Deterministic and offline; leaves no processes or temp files behind.
 */
export async function runDemo(onLine: (line: string) => void): Promise<DemoOutcome> {
  const dir = await mkdtemp(join(tmpdir(), 'framework-demo-'))
  const port = await freePort()
  await writeFile(join(dir, 'server.js'), ordersAppSource(port) + '\n')
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'orders-app', private: true }) + '\n')

  let preview: AppPreview | undefined
  try {
    const run = await runFramework({
      intent: DEMO_INTENT,
      driver: fakeDriver(),
      cwd: dir,
      signals: FAKE_SIGNALS,
      serve: { command: 'node server.js', port, waitMs: 8000, keepAlive: true },
      deploy: FAKE_DEPLOY,
      deployTarget: cloudflareTarget({
        session: simulatedCloudflare,
        apiToken: 'demo-token',
        accountId: 'demo-account',
        projectName: 'framework-demo',
      }),
      onEvent: event => onLine(formatFrameworkEvent(event)),
    })
    preview = run.preview

    // Prove the app the loop signed off on is actually serving right now.
    let served = ''
    if (preview) {
      const res = await fetch(preview.url)
      served = (await res.text()).replace(/\s+/g, ' ').trim()
    }

    return {
      framework: run.detection.framework,
      productionGrade: run.result.productionGrade,
      passes: run.result.passes,
      deployTarget: run.result.deploy?.plan.target,
      deployUrl: run.result.deploy?.result.url,
      previewUrl: preview?.url,
      served,
    }
  } finally {
    if (preview) await preview.stop()
    await rm(dir, { recursive: true, force: true })
  }
}
