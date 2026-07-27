import { randomUUID } from 'node:crypto'

/**
 * The session start-queue (#1328): sessions the daemon wants created on claude.ai, waiting for
 * the extension to go and create them.
 *
 * **Why this exists.** `claude --cloud` is the CLI's own path to a cloud session, and on at least
 * one account every session it creates is a bundle upload that can never push (#1320, upstream
 * anthropics/claude-code#81776). Sessions created through the claude.ai UI *with the repo picker*
 * are repo-bound and do push. The extension already lives on those pages, so it is the half of
 * this system that can reach the working path; this queue is how the daemon asks it to.
 *
 * **Direction is the security property.** The bridge's input surface is deliberately tiny: no
 * path, command, prompt or free text is ever *posted to* the daemon, so the worst a stolen bridge
 * token buys is a bogus card in someone's dashboard. A start request carries a repo, a branch and
 * a prompt — exactly the free text that rule excludes — and it stays excluded, because the daemon
 * is the *producer*. The extension reads a request and posts back only an id, a boolean and a
 * session id. Nothing here widens what an attacker holding the token can say.
 *
 * **In memory, like the questions store.** A queued start is only meaningful while the daemon that
 * wants it is running; surviving a restart would re-create sessions for runs that are already
 * gone, which costs real quota.
 */

/**
 * Where a start request has got to.
 *
 * `claimed` is a real state rather than a flag because two polls must not create two sessions for
 * one request — the extension can have several tabs, and a duplicate here is a duplicate cloud
 * session on the user's account.
 */
export type BridgeStartState = 'queued' | 'claimed' | 'created' | 'failed'

/** One session the daemon wants created, and what became of it. */
export interface BridgeStartRequest {
  id: string
  /** `owner/name`, as the repo picker lists it. */
  repo: string
  branch: string
  prompt: string
  queuedAt: string
  state: BridgeStartState
  /** When the extension took it, which is what {@link BridgeStarts.claimNext} ages out. */
  claimedAt?: string
  /** The cloud session it became, once the extension reports one. */
  sessionId?: string
  url?: string
  note?: string
}

/** What {@link BridgeStarts.request} needs. */
export interface BridgeStartInput {
  repo: string
  branch: string
  prompt: string
}

/**
 * How long a claim is honoured before the request goes back on the queue.
 *
 * A tab that is closed mid-creation, or a browser that quits, leaves a claim nobody will ever
 * resolve. Without an expiry that request is bricked for the life of the daemon, which is the
 * same failure the #1327 locks need a staleness rule for. Long enough that a slow page load does
 * not double-create, short enough that a person watching does not conclude it hung.
 */
export const START_CLAIM_TTL_MS = 90_000

/** `owner/name`: no slashes beyond the one, nothing shell-shaped. */
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
/**
 * A segment that is nothing but dots — `.` or `..`.
 *
 * The character class above happily matches `../etc`, because both `..` and `etc` are made of
 * legal characters. Checked separately rather than by tightening the class, because a leading dot
 * is legal in a real repo name (`owner/.github`) and only the all-dots segments are the traversal.
 */
const DOTS_ONLY = /^\.+$/
/** Git branch names we will hand over, kept to characters that cannot act as syntax anywhere. */
const BRANCH = /^[A-Za-z0-9._\-/]{1,255}$/
/** Past this a prompt is not a prompt, and the composer would not take it well either. */
const MAX_PROMPT = 20_000

/** The session start-queue. See the module comment for why the daemon is the producer. */
export class BridgeStarts {
  private readonly byId = new Map<string, BridgeStartRequest>()

  /**
   * Queue a session for the extension to create, or say why it cannot be.
   *
   * Validated here rather than at the endpoint because this is the *only* way in: the routes
   * expose reading and resolving, never queueing, so a caller holding the bridge token cannot
   * put a prompt on this queue at all.
   */
  request(input: BridgeStartInput, now = new Date()): BridgeStartRequest | string {
    const repo = input.repo.trim()
    if (!REPO.test(repo) || repo.split('/').some(segment => DOTS_ONLY.test(segment))) return 'repo must look like owner/name'
    const branch = input.branch.trim()
    if (!BRANCH.test(branch)) return 'branch must be a git branch name'
    const prompt = input.prompt.trim()
    if (!prompt) return 'prompt must not be empty'
    if (prompt.length > MAX_PROMPT) return `prompt must be at most ${MAX_PROMPT} characters`
    const start: BridgeStartRequest = {
      id: randomUUID(),
      repo,
      branch,
      prompt,
      queuedAt: now.toISOString(),
      state: 'queued',
    }
    this.byId.set(start.id, start)
    return start
  }

  /**
   * Hand the oldest waiting request to whoever is asking, and mark it claimed.
   *
   * Oldest first so a queue drains in the order it was filled. A claim older than
   * {@link START_CLAIM_TTL_MS} is treated as waiting again — see that constant for why.
   */
  claimNext(now = new Date()): BridgeStartRequest | undefined {
    const stale = now.getTime() - START_CLAIM_TTL_MS
    const waiting = [...this.byId.values()]
      .filter(start => start.state === 'queued' || (start.state === 'claimed' && Date.parse(start.claimedAt ?? '') <= stale))
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    const next = waiting[0]
    if (!next) return undefined
    const claimed: BridgeStartRequest = { ...next, state: 'claimed', claimedAt: now.toISOString() }
    this.byId.set(claimed.id, claimed)
    return claimed
  }

  /**
   * The extension's word on what a creation attempt did.
   *
   * A success needs the session id: without it the run has nowhere to point, so a report that
   * claims success and names no session is recorded as a failure rather than a session we cannot
   * find. Only a claimed request can be resolved, so a stale report from a tab that died after its
   * claim expired cannot overwrite the retry that replaced it.
   */
  resolve(id: string, ok: boolean, sessionId?: string, note?: string): void {
    const start = this.byId.get(id)
    if (!start || start.state !== 'claimed') return
    if (ok && !sessionId) {
      this.byId.set(id, { ...start, state: 'failed', note: note ?? 'reported success without a session id' })
      return
    }
    this.byId.set(id, {
      ...start,
      state: ok ? 'created' : 'failed',
      ...(sessionId ? { sessionId, url: `https://claude.ai/code/${sessionId}` } : {}),
      ...(note ? { note } : {}),
    })
  }

  /** One request, in whatever state. */
  get(id: string): BridgeStartRequest | undefined {
    return this.byId.get(id)
  }

  /** Every request, newest first. */
  list(): BridgeStartRequest[] {
    return [...this.byId.values()].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
  }

  /** Forget one request, once whoever asked for it has read the outcome. */
  clear(id: string): void {
    this.byId.delete(id)
  }
}

/**
 * The daemon's one start-queue. A module singleton for the same reason the questions store is
 * one: the bridge endpoint writes from the raw HTTP handler and the driver reads from elsewhere
 * in the process, and neither can be handed the other's object.
 */
let instance: BridgeStarts | undefined

export function bridgeStarts(): BridgeStarts {
  if (!instance) instance = new BridgeStarts()
  return instance
}

/** Replace the store. Tests only: a module singleton would otherwise leak between them. */
export function resetBridgeStarts(): void {
  instance = undefined
}
