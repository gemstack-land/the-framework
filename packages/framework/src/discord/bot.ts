import { DiscordGateway, type DiscordMessage, type GatewayDeps } from './gateway.js'
import { postMessage } from './rest.js'
import { decideAction, type ProjectTarget, type RunSnapshot } from './routing.js'

/**
 * The Discord chatbot (#680): chat to The Framework from Discord instead of the dashboard.
 *
 * Every effect is an injected function, so the whole bot is testable by handing it a fake
 * message — the routing decisions live in `routing.ts` and are pure, and this module is only
 * the wiring. Same seam-and-`stop()` shape as the intervention/activity watchers.
 *
 * Chat history is not written here: a message routed into a run reaches that run's conversation
 * through the control channel, and the run commits it to `.the-framework/conversations/` (#908).
 * That is the answer to the question #680 asked — the Git repo, via the run that received it.
 */

/**
 * How a turn that arrived here is attributed in the committed conversation (#917). Named once,
 * here, so the surface owns its own name rather than the daemon spelling it inline twice.
 */
export const DISCORD_VIA = 'discord'

/** Everything the bot needs from the daemon. */
export interface DiscordBotOptions {
  /** The bot token. Distinct from the notification webhook (#627), which cannot read replies. */
  token: string
  /** The project a message belongs to when no run is live. */
  target: () => Promise<ProjectTarget | undefined>
  /** That project's live run, if it has one. */
  liveRun: (projectId: string) => Promise<RunSnapshot | undefined>
  /** Start a new run; resolves the run id, or `undefined` when it could not start. */
  start: (projectId: string, text: string) => Promise<string | undefined>
  sendMessage: (projectId: string, text: string, runId: string) => Promise<void>
  sendChoice: (projectId: string, gateId: string, pick: string | string[], runId: string) => Promise<void>
  sendStop: (projectId: string, runId: string) => Promise<void>
  /**
   * Whether the bot should act, read per message rather than at start, so turning it off takes
   * effect without restarting the daemon — the same contract the notification watchers follow.
   */
  enabled?: () => Promise<boolean>
  /** Restrict the bot to one channel. Unset means it answers wherever it is addressed. */
  channelId?: string | undefined
  fetchImpl?: typeof fetch
  onLog?: (message: string) => void
  /** Gateway seams, for tests. */
  gateway?: GatewayDeps
}

/** A running bot. `stop()` is what takes it offline on `Ctrl+C`. */
export interface DiscordBot {
  stop(): void
  /** Handle one message. Exposed so tests drive a cycle without a socket, like the watchers' `poll()`. */
  handleMessage(message: DiscordMessage): Promise<void>
}

/**
 * Connect the bot and route messages. Never throws: a chat integration that can take the daemon
 * down is worse than one that is quiet.
 */
export function startDiscordBot(opts: DiscordBotOptions): DiscordBot {
  const log = (message: string): void => opts.onLog?.(message)

  const handleMessage = async (message: DiscordMessage): Promise<void> => {
    try {
      if (opts.channelId && message.channelId !== opts.channelId) return
      if (opts.enabled && !(await opts.enabled())) return

      const target = await opts.target()
      if (!target) {
        await reply(message, 'No project is registered with The Framework yet.')
        return
      }
      const live = await opts.liveRun(target.id).catch(() => undefined)
      const action = decideAction(message.content, { live, target })

      switch (action.kind) {
        case 'choice':
          await opts.sendChoice(action.projectId, action.gateId, action.pick, action.runId)
          break
        case 'message':
          await opts.sendMessage(action.projectId, action.text, action.runId)
          break
        case 'stop':
          await opts.sendStop(action.projectId, action.runId)
          break
        case 'start': {
          const runId = await opts.start(action.projectId, action.text)
          if (!runId) {
            await reply(message, 'Could not start a session. It may already be busy.')
            return
          }
          break
        }
        case 'reply':
          break
      }
      await reply(message, action.reply)
    } catch (err) {
      log(`Discord bot could not handle a message: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const reply = async (to: DiscordMessage, content: string): Promise<void> => {
    const sent = await postMessage(opts.token, to.channelId, content, {
      replyToId: to.id,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    })
    if (!sent) log('Discord bot could not post a reply')
  }

  const gateway = new DiscordGateway(
    opts.token,
    {
      onMessage: message => void handleMessage(message),
      onReady: id => log(`Discord bot online (${id})`),
      onLog: log,
    },
    opts.gateway ?? {},
  )
  gateway.connect()

  return {
    stop: () => {
      gateway.stop()
      log('Discord bot offline')
    },
    handleMessage,
  }
}
