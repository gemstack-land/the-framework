import type {
  AgentPromptOptions,
  AgentResponse,
  AgentStreamResponse,
  AiMessage,
  ConversationalOverride,
  ConversationalSpec,
  ConversationStore,
  StreamChunk,
} from './types.js'

/**
 * Internal hook that's awaited by the persistence helpers to find the
 * registered `ConversationStore`. Wired to `setConversationStore()` /
 * `AiProvider`'s `ai.conversations` DI binding via `agent.ts` —
 * provided here as a parameter to keep this file dependency-free.
 */
export type ConversationStoreLookup = () => ConversationStore | null | undefined

/**
 * Resolves the effective {@link ConversationalSpec} for a single
 * `prompt()` / `stream()` call. Returns `null` when the call should run
 * stateless (no auto-persist).
 *
 * Precedence (high → low):
 * 1. Per-call `options.conversation` — `false` opts out, a spec replaces
 *    the agent's declaration.
 * 2. Agent's `conversational()` — supports sync OR async returns.
 *
 * The `ConversableAgent` (`forUser` / `continue`) flow does **not** go
 * through this resolver — it builds its own spec and calls the helper
 * directly so the explicit form always wins over both layers below.
 */
export async function resolveAutoPersistSpec(
  agentDecl:    () => false | ConversationalSpec | Promise<false | ConversationalSpec>,
  perCall:      ConversationalOverride | undefined,
): Promise<ConversationalSpec | null> {
  if (perCall === false) return null
  if (perCall && typeof perCall === 'object') {
    if (!perCall.user && !perCall.id) return null  // invalid override → opt out
    return perCall
  }

  const declared = await agentDecl()
  if (declared === false || !declared) return null
  if (!declared.user && !declared.id) return null
  return declared
}

/**
 * Thrown when a run scoped to one user tries to resume a thread another user
 * owns (#984). A distinct type so a server can answer 403 rather than 500,
 * and so a store failure is never mistaken for a refusal.
 */
export class ConversationOwnershipError extends Error {
  readonly conversationId: string
  /** The user the run was scoped to. Never carries the real owner's id. */
  readonly userId: string | undefined
  constructor(conversationId: string, userId: string | undefined) {
    const hint = userId
      ? ''
      : ' The call carries no user; chain forUser(ownerId) before continue(id).'
    super(`[ai-sdk] Conversation "${conversationId}" is owned by a different user.${hint}`)
    this.name = 'ConversationOwnershipError'
    this.conversationId = conversationId
    this.userId = userId
  }
}

/**
 * What the store could tell us about a thread's owner.
 *
 * `owner: undefined` is deliberately permissive: threads written before #984,
 * and stores that don't mirror `meta.userId` into their listings, carry no
 * owner and must stay readable by whoever holds the id.
 *
 * `hidden` is the one case that is not permissive: the store demonstrably
 * holds rows its unscoped `list()` did not report, so "absent from the
 * listing" is no evidence of being ownerless.
 */
interface OwnerLookup {
  owner:  string | undefined
  hidden: boolean
}

async function storedOwner(
  store:  ConversationStore,
  convId: string,
  user:   string | undefined,
): Promise<OwnerLookup> {
  // Scoped listing first — the indexed read every store already supports, and
  // a hit settles ownership without enumerating every thread in the backend.
  if (user) {
    const mine = await store.list(user)
    if (mine.some(t => t.id === convId)) return { owner: user, hidden: false }

    const all   = await store.list()
    const entry = all.find(t => t.id === convId)
    if (entry) return { owner: entry.userId || undefined, hidden: false }
    // Rows listed but not this one: absent thread or partial listing, and we
    // can't tell which, so stay permissive.
    if (all.length > 0) return { owner: undefined, hidden: false }
    // Nothing listed while the store demonstrably holds rows: list() is not
    // enumerating the backend, so it never had a chance to report an owner.
    const hidden = mine.length > 0 || (await store.load(convId)).length > 0
    return { owner: undefined, hidden }
  }

  const entry = (await store.list()).find(t => t.id === convId)
  return { owner: entry?.userId || undefined, hidden: false }
}

/**
 * Resuming by id must be scoped to the user the run runs as (#984), otherwise
 * any caller holding a thread id reads that thread's history into their run
 * and appends their turn back into it.
 */
async function assertOwnership(
  store:  ConversationStore,
  convId: string,
  user:   string | undefined,
): Promise<void> {
  const { owner, hidden } = await storedOwner(store, convId, user)
  if (hidden) throw new ConversationOwnershipError(convId, user)
  if (owner === undefined) return
  if (owner !== (user || undefined)) throw new ConversationOwnershipError(convId, user)
}

interface PersistenceContext {
  spec:    ConversationalSpec
  store:   ConversationStore
  /** Stable thread id, set after lookup/create. */
  convId:  string
  /** Loaded history merged with the caller's `options.history`. */
  history: AiMessage[]
  /**
   * Full server-persisted history as loaded from the store, BEFORE the
   * `historyLimit` slice and BEFORE merging caller history. This is the
   * trusted baseline handed to the `validate` continuation hook.
   */
  persisted: AiMessage[]
}

/**
 * Run the load-or-create-thread half of the persistence flow. Resolves
 * the conversation id, loads history, applies `historyLimit`, and merges
 * with any caller-supplied `options.history`. An explicit id is owner-checked
 * first (#984); the lookup-by-user branch is scoped by the store already.
 */
async function preparePersistence(
  spec:           ConversationalSpec,
  agentClassName: string,
  store:          ConversationStore,
  callerHistory:  AiMessage[] | undefined,
): Promise<PersistenceContext> {
  let convId = spec.id
  let loaded: AiMessage[] = []

  if (convId) {
    await assertOwnership(store, convId, spec.user)
    loaded = await store.load(convId)
  } else if (spec.user) {
    const agentKey = spec.agent ?? agentClassName
    const threads  = await store.list(spec.user)
    // Most-recent thread for this (user, agent) pair. Stores filter by
    // `userId` already; we filter by the agent meta locally so existing
    // stores (which may not persist `agent` in `list()` results) still
    // work — they'll just always create new threads, which is the
    // conservative behavior.
    const candidates = threads.filter(t => (t.agent ?? null) === agentKey)
    const mostRecent = candidates.sort((a, b) => {
      const aT = (a.updatedAt ?? a.createdAt).getTime()
      const bT = (b.updatedAt ?? b.createdAt).getTime()
      return bT - aT
    })[0]

    if (mostRecent) {
      convId = mostRecent.id
      loaded = await store.load(convId)
    } else {
      convId = await store.create(undefined, { userId: spec.user, agent: agentKey })
    }
  } else {
    throw new Error('[ai-sdk] ConversationalSpec must include either `user` or `id`.')
  }

  // Snapshot the trusted baseline before any limit slice — the validation
  // hook compares the caller's incoming messages against the FULL persisted
  // thread, not the windowed view fed to the model.
  const persisted = loaded

  let windowed = loaded
  if (spec.historyLimit !== undefined && spec.historyLimit > 0) {
    windowed = loaded.slice(-spec.historyLimit)
  }

  const history = [...windowed, ...(callerHistory ?? [])]
  return { spec, store, convId, history, persisted }
}

/**
 * Run the caller-supplied `validate` continuation hook, if present. The
 * "incoming" view is the caller's claimed prior conversation — their
 * `options.messages` (full continuation list) when set, else
 * `options.history`. Throws (propagating the rejection) when the hook does.
 */
async function runValidation(
  ctx:     PersistenceContext,
  options: AgentPromptOptions | undefined,
): Promise<void> {
  if (!options?.validate) return
  const incoming = options.messages ?? options.history ?? []
  const opts: { approvedToolCallIds?: readonly string[]; rejectedToolCallIds?: readonly string[] } = {}
  if (options.approvedToolCallIds) opts.approvedToolCallIds = options.approvedToolCallIds
  if (options.rejectedToolCallIds) opts.rejectedToolCallIds = options.rejectedToolCallIds
  await options.validate(ctx.persisted, incoming, opts)
}

/**
 * Compose the new turn's messages from the user input + the steps the
 * agent loop produced. Mirrors the old `ConversableAgent.prompt`
 * persistence shape exactly so downstream stores see no behavioral change.
 */
export function newMessagesFromTurn(input: string, response: AgentResponse): AiMessage[] {
  const out: AiMessage[] = [{ role: 'user', content: input }]
  for (const step of response.steps) {
    out.push(step.message)
    for (const tr of step.toolResults) {
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
      out.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
    }
  }
  return out
}

/**
 * Wrap a non-streaming agent run with conversation persistence. Loads
 * history before, appends the new turn after, and stamps `conversationId`
 * onto the result.
 *
 * `inner` receives the merged options (with the loaded history pre-pended
 * to `options.history`) and is expected to invoke the actual agent loop.
 */
export async function runWithPersistence(
  spec:           ConversationalSpec,
  agentClassName: string,
  storeLookup:    ConversationStoreLookup,
  input:          string,
  options:        AgentPromptOptions | undefined,
  inner:          (effOptions: AgentPromptOptions | undefined) => Promise<AgentResponse>,
): Promise<AgentResponse> {
  const store = storeLookup()
  if (!store) throw new Error('[ai-sdk] No ConversationStore registered. Bind one via `setConversationStore()` or the `ai.conversations` DI key.')

  const ctx = await preparePersistence(spec, agentClassName, store, options?.history)
  await runValidation(ctx, options)
  const effOptions: AgentPromptOptions = { ...options, history: ctx.history }
  const response = await inner(effOptions)

  await store.append(ctx.convId, newMessagesFromTurn(input, response))
  return { ...response, conversationId: ctx.convId }
}

/**
 * Wrap a streaming agent run with conversation persistence. Same shape as
 * {@link runWithPersistence}, but stitched into the
 * `AgentStreamResponse` `{ stream, response }` pair so the caller sees
 * stream chunks flowing first and the persisted result resolving last.
 */
export function runWithPersistenceStreaming(
  spec:           ConversationalSpec,
  agentClassName: string,
  storeLookup:    ConversationStoreLookup,
  input:          string,
  options:        AgentPromptOptions | undefined,
  inner:          (effOptions: AgentPromptOptions | undefined) => AgentStreamResponse,
): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  let rejectResponse:  (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((res, rej) => { resolveResponse = res; rejectResponse = rej })

  async function* outer(): AsyncIterable<StreamChunk> {
    const store = storeLookup()
    if (!store) {
      const err = new Error('[ai-sdk] No ConversationStore registered. Bind one via `setConversationStore()` or the `ai.conversations` DI key.')
      rejectResponse!(err)
      throw err
    }

    let ctx: PersistenceContext
    try {
      ctx = await preparePersistence(spec, agentClassName, store, options?.history)
      await runValidation(ctx, options)
    } catch (err) {
      rejectResponse!(err)
      throw err
    }

    const innerResp = inner({ ...options, history: ctx.history })
    try {
      for await (const chunk of innerResp.stream) yield chunk
    } catch (err) {
      rejectResponse!(err)
      throw err
    }

    const response = await innerResp.response
    try {
      await store.append(ctx.convId, newMessagesFromTurn(input, response))
    } catch (err) {
      rejectResponse!(err)
      throw err
    }
    resolveResponse!({ ...response, conversationId: ctx.convId })
  }

  return { stream: outer(), response: responsePromise }
}
