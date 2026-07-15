import { spawn as nodeSpawn } from 'node:child_process'
import type { DriverQuota, DriverQuotaWindow } from './types.js'
import type { SpawnLike } from './claude-code.js'

/** How long we wait for the readout before calling it a timeout. */
const READ_TIMEOUT_MS = 20_000

/**
 * Present in both subscription headers Claude Code can print (`"your
 * subscription"` and, mid-overage, `"your overages"`), and in neither
 * non-subscription case. Matching the shared tail rather than the word
 * "subscription" is deliberate: an account burning overage still has a quota to
 * report, and keying on "subscription" would read it as having none.
 */
const SUBSCRIPTION_HEADER = /to power your Claude Code usage/

/**
 * One `"<label>: <n>% used · resets <when>"` line.
 *
 * Anchored and strict on `% used` immediately after the colon, because the same
 * readout carries lines that are shaped just closely enough to match a lazier
 * pattern (`"Top skills: /dataviz 2%, /claude-api 1%"`, `"  70% of your usage
 * was at >150k context"`).
 */
const WINDOW_LINE = /^(.+?):\s+(\d+(?:\.\d+)?)% used(?:\s*·\s*(.+))?$/

/** Strips the `resets` verb, which is prose framing rather than part of the value. */
const RESETS_PREFIX = /^resets\s+/

function windowKind(label: string): DriverQuotaWindow['kind'] {
  if (/^current session$/i.test(label)) return 'session'
  if (/^current week \(all models\)$/i.test(label)) return 'week'
  if (/^current week \(.+\)$/i.test(label)) return 'week-model'
  return 'unknown'
}

/**
 * Parse Claude Code's `/usage` readout (#521).
 *
 * The agent prints prose, so this is a text parse and a reworded readout is a
 * real failure mode. It fails to `unrecognized` rather than to an empty reading:
 * a silent zero would read as "nothing used" and let a consumption limit run the
 * account dry.
 */
export function parseQuotaReadout(text: string): DriverQuota {
  const windows: DriverQuotaWindow[] = []
  for (const line of text.split('\n')) {
    const match = WINDOW_LINE.exec(line.trim())
    if (!match) continue
    const [, label, percent, resets] = match
    if (label === undefined || percent === undefined) continue
    const resetsAtText = resets?.replace(RESETS_PREFIX, '').trim()
    windows.push({
      label,
      kind: windowKind(label),
      percentUsed: Number(percent),
      ...(resetsAtText ? { resetsAtText } : {}),
    })
  }

  if (windows.length > 0) return { available: true, windows }
  // No windows and no subscription header: the account has no quota to report
  // (API-key auth). With the header, it does have one and we simply failed to
  // read it, which is a parser problem and must not masquerade as the former.
  return { available: false, reason: SUBSCRIPTION_HEADER.test(text) ? 'unrecognized' : 'no-subscription' }
}

/** Options for {@link readClaudeQuota}. */
export interface ReadClaudeQuotaOptions {
  /** CLI binary to spawn. Default `"claude"` (resolved on `PATH`). */
  bin?: string
  /** Working directory for the child. The read is account-wide, so this is incidental. */
  cwd?: string
  /** Environment for the child process. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
  /** Abort the read. */
  signal?: AbortSignal
  /** Override the timeout. Default {@link READ_TIMEOUT_MS}. */
  timeoutMs?: number
}

/**
 * Ask Claude Code where the account's subscription quota stands (#521).
 *
 * Runs the CLI's own `/usage` command in print mode. Costs nothing: verified on
 * 2.1.210 as `total_cost_usd: 0` across zero turns and zero tokens, because the
 * CLI answers it locally rather than by prompting a model. It reaches Anthropic
 * itself, with its own credentials, so The Framework never reads or handles the
 * user's token.
 *
 * Never pass `--bare` here: it pins the CLI to API-key auth and never reads the
 * OAuth credentials, so the subscription quota this reads would vanish.
 */
export function readClaudeQuota(opts: ReadClaudeQuotaOptions = {}): Promise<DriverQuota> {
  return new Promise<DriverQuota>(resolvePromise => {
    if (opts.signal?.aborted) {
      resolvePromise({ available: false, reason: 'timeout' })
      return
    }

    const spawn = opts.spawn ?? (nodeSpawn as unknown as SpawnLike)
    const child = spawn(opts.bin ?? 'claude', ['-p', '/usage', '--output-format', 'json'], {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? process.env,
    })

    let settled = false
    const chunks: string[] = []
    const settle = (quota: DriverQuota) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolvePromise(quota)
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      settle({ available: false, reason: 'timeout' })
    }
    opts.signal?.addEventListener('abort', onAbort)

    // Deliberately not unref'd: this timer is the only thing guaranteeing the
    // promise settles, and an unref'd one never fires once the loop goes idle,
    // leaving the caller awaiting forever. `settle` clears it either way.
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      settle({ available: false, reason: 'timeout' })
    }, opts.timeoutMs ?? READ_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer | string) => chunks.push(String(chunk)))
    // ENOENT lands here rather than as a non-zero exit.
    child.on('error', () => settle({ available: false, reason: 'agent-not-found' }))
    child.on('close', code => {
      if (code !== 0) {
        settle({ available: false, reason: 'fetch-failed' })
        return
      }
      settle(parseQuotaResponse(chunks.join('')))
    })
  })
}

/** Unwrap the CLI's `--output-format json` envelope and parse the readout inside it. */
function parseQuotaResponse(stdout: string): DriverQuota {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch {
    return { available: false, reason: 'unrecognized' }
  }
  if (typeof envelope !== 'object' || envelope === null) return { available: false, reason: 'unrecognized' }
  const obj = envelope as Record<string, unknown>
  // The CLI's own failure arm, e.g. its usage fetch was refused upstream.
  if (obj['is_error'] === true) return { available: false, reason: 'fetch-failed' }
  const result = obj['result']
  if (typeof result !== 'string') return { available: false, reason: 'unrecognized' }
  return parseQuotaReadout(result)
}
