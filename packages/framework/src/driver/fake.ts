import type { Driver, DriverEvent, DriverPromptOptions, DriverSession, DriverStartOptions, DriverTurn, DriverUsage } from './types.js'

/** One scripted turn the {@link FakeDriver} replays. */
export interface FakeTurn {
  /** The final assistant text. */
  text: string
  /** Tool names to emit as `action` events before the result (visual only). */
  actions?: string[]
  /** Token + cost accounting to report for this turn (#322). Omitted = no usage. */
  usage?: DriverUsage
}

/** Options for {@link FakeDriver}. */
export interface FakeDriverOptions {
  /**
   * Scripted turns, consumed in order across all `prompt` calls of a session.
   * Once exhausted the last one repeats, so a short script never starves a
   * longer run. Ignored when {@link respond} is set.
   */
  turns?: FakeTurn[]
  /** Answer dynamically from the prompt. Takes precedence over {@link turns}. */
  respond?: (prompt: string, index: number) => FakeTurn | string
  /** Files each session is pre-seeded with, exposed via {@link DriverSession.readCode}. */
  files?: Record<string, string>
  /** Session id to report (default `"fake-session"`). */
  sessionId?: string
}

function asTurn(value: FakeTurn | string): FakeTurn {
  return typeof value === 'string' ? { text: value } : value
}

/**
 * An in-memory {@link Driver} for tests and `--fake` runs: it never spawns a
 * process, replays scripted turns deterministically, and emits the same
 * {@link DriverEvent} shape a real driver does. Mirrors `AiFake` /
 * `FakeRunner`, so the whole flow runs offline with no CLI and no model.
 */
export class FakeDriver implements Driver {
  readonly name = 'fake'
  constructor(private readonly opts: FakeDriverOptions = {}) {}

  // Narrowed to the concrete session so callers can read `prompts` for assertions.
  start(opts: DriverStartOptions): Promise<FakeDriverSession> {
    return Promise.resolve(new FakeDriverSession(this.opts, opts))
  }
}

/** A single {@link FakeDriver} session. Records every prompt for assertions. */
export class FakeDriverSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  /** Every prompt this session received, in order. */
  readonly prompts: string[] = []
  private index = 0

  constructor(
    private readonly config: FakeDriverOptions,
    private readonly startOpts: DriverStartOptions,
  ) {
    this.id = config.sessionId ?? 'fake-session'
    this.cwd = startOpts.cwd
  }

  prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    if (this.startOpts.signal?.aborted || opts.signal?.aborted) {
      return Promise.reject(new Error('[framework] fake prompt aborted'))
    }
    const i = this.index++
    this.prompts.push(text)
    const turn = this.resolveTurn(text, i)

    this.emit({ type: 'start', prompt: text })
    for (const label of turn.actions ?? []) this.emit({ type: 'action', label })
    if (turn.text) this.emit({ type: 'text', text: turn.text })
    this.emit({ type: 'result', text: turn.text, sessionId: this.id, ...(turn.usage ? { usage: turn.usage } : {}) })

    return Promise.resolve({ text: turn.text, sessionId: this.id, ...(turn.usage ? { usage: turn.usage } : {}) })
  }

  readCode(path: string): Promise<string> {
    const contents = this.config.files?.[path]
    if (contents === undefined) return Promise.reject(new Error(`[framework] fake driver has no file ${path}`))
    return Promise.resolve(contents)
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  private resolveTurn(text: string, i: number): FakeTurn {
    if (this.config.respond) return asTurn(this.config.respond(text, i))
    const turns = this.config.turns ?? []
    if (turns.length === 0) return { text: '' }
    return turns[Math.min(i, turns.length - 1)]!
  }

  private emit(event: DriverEvent): void {
    const on = this.startOpts.onEvent
    if (!on) return
    try {
      on(event)
    } catch (err) {
      console.error('[framework] fake driver onEvent threw; ignoring:', err)
    }
  }
}
