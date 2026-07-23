import { spawn, type ChildProcess } from 'node:child_process'
import type { ClaudeCodeDriverOptions, McpServerSpec } from './driver/index.js'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * The run's browser (#793, first slice of #609).
 *
 * `--browser` (#452) used to let chrome-devtools-mcp launch its own Chrome. That is fine
 * while the agent is the only client, but #609 wants a human watching the same page over a
 * screencast, and a second client cannot attach to a browser whose port we never opened. So
 * the run launches Chrome itself with `--remote-debugging-port` and hands the MCP server a
 * `--browserUrl`. Chrome takes both CDP clients at once, which is what makes the preview and
 * the step-in relay possible at all.
 */
export interface SharedBrowser {
  /** The CDP endpoint both the agent and any preview attach to. */
  browserUrl: string
  /** Kill Chrome and remove its throwaway profile. Safe to call twice. */
  close(): Promise<void>
}

/** Where Chrome usually lives, per platform. First hit wins. */
const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
}

/** The binaries to look for on `PATH` when no well-known path exists. */
const CHROME_BINARIES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

/** Whether a path exists. Injectable so a test does not depend on what the host has installed. */
export type ExistsFn = (path: string) => boolean

/** First existing match for `name` on `PATH`, or undefined. */
function onPath(name: string, env: NodeJS.ProcessEnv, platform: string, exists: ExistsFn): string | undefined {
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const full = join(dir, name + ext)
      if (exists(full)) return full
    }
  }
  return undefined
}

/**
 * The Chrome binary to launch, or undefined when the machine has none. `CHROME_PATH` (and
 * Puppeteer's variable, since a repo that has one usually means it) wins so a user on a
 * non-standard install is not stuck.
 *
 * `exists` is a parameter rather than a direct `existsSync` call so the lookup can be tested
 * against a known filesystem: CI runners have Chrome installed, so a test that assumes the
 * well-known paths are absent passes on a laptop and fails there.
 */
export function resolveChromePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  exists: ExistsFn = existsSync,
): string | undefined {
  for (const override of [env.CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH]) {
    if (override && exists(override)) return override
  }
  for (const candidate of CHROME_PATHS[platform] ?? []) {
    if (exists(candidate)) return candidate
  }
  for (const name of CHROME_BINARIES) {
    const found = onPath(name, env, platform, exists)
    if (found) return found
  }
  return undefined
}

/**
 * The launch flags. Headless by default — the agent has no screen, and a screencast reads a
 * headless page fine. The profile is throwaway so a run never inherits (or dirties) the
 * user's real Chrome session.
 */
export function chromeLaunchArgs(port: number, userDataDir: string, headless = true): string[] {
  return [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,720',
    'about:blank',
  ]
}

/** A free localhost port, asked of the OS rather than guessed. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

/**
 * Poll `/json/version` until Chrome answers. Chrome opens the port a beat after the process
 * starts, so handing the MCP server a URL that is not listening yet is the obvious race.
 */
export async function waitForDebugEndpoint(
  browserUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const { timeoutMs = 15_000, intervalMs = 100, fetchImpl = fetch } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${browserUrl}/json/version`)
      if (res.ok) return true
    } catch {
      // Not listening yet.
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

/**
 * Launch the run's Chrome, or return undefined when this machine has none — in which case the
 * caller leaves `--browser` exactly as it was (chrome-devtools-mcp launches its own). A
 * missing browser should cost the run its preview, never its browser tools.
 */
export async function launchSharedBrowser(
  opts: { chromePath?: string | undefined; headless?: boolean; timeoutMs?: number } = {},
): Promise<SharedBrowser | undefined> {
  const chromePath = opts.chromePath ?? resolveChromePath()
  if (!chromePath) return undefined

  const port = await freePort()
  const userDataDir = await mkdtemp(join(tmpdir(), 'framework-chrome-'))
  const browserUrl = `http://127.0.0.1:${port}`

  let child: ChildProcess
  try {
    child = spawn(chromePath, chromeLaunchArgs(port, userDataDir, opts.headless ?? true), { stdio: 'ignore' })
  } catch {
    await rm(userDataDir, { recursive: true, force: true })
    return undefined
  }

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    child.kill()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }

  // A Chrome that dies on its own must not leave the run pointing at a dead port. `error`
  // needs its own handler or a failed spawn (bad path, no exec bit) throws unhandled and
  // takes the run with it — a missing browser must only cost the preview.
  child.on('exit', () => void close())
  child.on('error', () => void close())

  const timeoutOpt = opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }
  if (!(await waitForDebugEndpoint(browserUrl, timeoutOpt))) {
    await close()
    return undefined
  }
  return { browserUrl, close }
}

/**
 * The `--browser` MCP wiring (#452): chrome-devtools-mcp is a maintained stdio
 * server that launches its own Chromium and exposes DevTools tools (navigate,
 * console, network, DOM, screenshot). `npx -y` resolves it on demand so there is
 * nothing to pre-install. Merged into the build driver only, not the short
 * preset-router turn.
 */
export const BROWSER_MCP_SERVERS: Record<string, McpServerSpec> = {
  'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
}

/**
 * The same server, pointed at a Chrome the run already launched (#793). `--browserUrl` makes
 * it attach instead of launching, which is what lets a second client (the #609 screencast)
 * watch the very page the agent is on. Without a URL this is the old spec unchanged.
 */
export function browserMcpServers(browserUrl?: string | undefined): Record<string, McpServerSpec> {
  if (!browserUrl) return BROWSER_MCP_SERVERS
  return { 'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', browserUrl] } }
}

/** Fold the `--browser` MCP server into driver options when the flag is set. */
export function withBrowser(
  base: ClaudeCodeDriverOptions,
  browser: boolean,
  browserUrl?: string | undefined,
): ClaudeCodeDriverOptions {
  if (!browser) return base
  return { ...base, mcpServers: { ...base.mcpServers, ...browserMcpServers(browserUrl) } }
}
