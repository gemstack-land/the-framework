import { basename, resolve } from 'node:path'
import { listProjects, projectId, readPreferences, readProjectPreferences, resolvePreferences, type Preferences } from './registry.js'
import { discordNotificationEnabled, notificationEnabled } from './preference-defaults.js'
import { runOptionsFromPreferences, preferencesFromFileConfig } from './run-options.js'
import { loadFrameworkConfig } from './config.js'
import { readSuspendedRuns, writeSuspendedRuns, resumableRuns, readLiveMetas, listRuns } from './store/index.js'
import { startKeyedWatcher, type KeyedWatcher } from './dashboard/keyed-watcher.js'
import { buildInterventions, interventionKey, postInterventionsDiscord } from './dashboard/interventions.js'
import { buildActivity, activityKey, postActivityDiscord } from './dashboard/activity.js'
import { startAutoPm, AUTO_PM_JOBS } from './auto-pm.js'
import { maintenanceDue, readMaintenanceState, mergeMaintenanceState } from './maintenance.js'
import { promoteQueue } from './queue-promote.js'
import { findTodoBacklog } from './todo-loop.js'
import { startConversationCommitter } from './conversation-commit.js'
import { readConversation } from './conversations.js'
import { startDiscordBot, DISCORD_VIA } from './discord/bot.js'
import { startDiscordReplyMirror } from './discord/reply-mirror.js'
import { snapshotLiveRun } from './discord/live-run.js'
import { postMessage } from './discord/rest.js'
import { sendChoice, sendMessage, sendStop } from './dashboard-rpc/control.telefunc.js'
import type { ProjectSummary } from './dashboard/projects.js'
import type { QuotaSource } from './dashboard/quota.js'
import type { StartRunOptions, StartRunResult } from './dashboard/types.js'

/**
 * Everything the daemon runs in the background beside serving the dashboard: the two Discord
 * notification watchers (#627), auto PM (#685/#773), the conversation committer (#912), and the
 * Discord chatbot (#680) with its reply mirror (#932).
 *
 * All of it used to sit inline in `runDaemon`, which meant its body was a lifecycle narrative with
 * ~200 lines of service wiring in the middle of it. Each of these is gated the same way (an env
 * var says *where*, a preference says *whether*), each reads its preference per tick so a header
 * toggle takes effect without a restart, and three of them start runs the same way — so they
 * belong together, and the daemon body is left with the sequence it actually owns.
 */

/** What the daemon needs back: the two shutdown phases, in the order the daemon's teardown needs them. */
export interface BackgroundServices {
  /**
   * Stop everything that could start or steer a run, before the daemon suspends the runs it owns.
   * Ordered first on purpose: auto PM or a Discord message arriving mid-shutdown would otherwise
   * start a run while we are busy stopping them.
   */
  quiesce: () => void
  /**
   * Commit whatever conversation the shutdown just ended (#912), after the runs have been stopped
   * so their last turns are on disk. Returns how many projects were committed.
   */
  flushConversations: () => Promise<number>
}

/** What {@link startBackgroundServices} needs from the daemon. */
export interface BackgroundServiceDeps {
  /** The daemon's home workspace. Chat has no project picker, so a message with no run starts one here. */
  cwd: string
  env: NodeJS.ProcessEnv
  /** The dashboard's own URL, so a paused-run item (#636) can link back to it. */
  dashboardUrl: string
  /** The long-lived quota meter the usage panel draws; auto PM gates on the same reading. */
  quota: QuotaSource
  /** Start a run in a project. */
  startRun: (prompt: string, options: StartRunOptions, projectId: string) => Promise<StartRunResult>
  /** How many runs are live on a project, so a background job can tell idle from busy. */
  activeRunCount: (projectId: string) => number
  log: (message: string) => void
}

/** The registered projects as dashboard summaries. */
async function listSummaries(env: NodeJS.ProcessEnv): Promise<ProjectSummary[]> {
  const records = await listProjects(undefined, env).catch(() => [])
  return records.map(p => ({ id: p.id, path: p.path, name: basename(p.path), activated: true }))
}

/** The user's preferences, or empty when they cannot be read — the defaults are what a run would use anyway. */
function readPrefs(env: NodeJS.ProcessEnv): Promise<Preferences> {
  return readPreferences(undefined, env).catch(() => ({}) as Preferences)
}

/**
 * The run options a project's settings imply (#858): the global tier, then the repo's committed
 * `the-framework.yml` (#842), then the project's own overrides (#840) on top. The same mapping and
 * the same layer order the launcher uses, so a run started by the daemon and a run started by hand
 * differ only in who asked for it. An unreadable tier falls back to empty rather than failing the
 * start: the defaults are what the run would have used anyway.
 */
async function resolveProjectRunOptions(id: string, env: NodeJS.ProcessEnv): Promise<StartRunOptions> {
  const global = await readPrefs(env)
  const project = await readProjectPreferences(id, undefined, env).catch(() => undefined)
  const path = (await listProjects(undefined, env).catch(() => [])).find(p => p.id === id)?.path
  const file = path ? await loadFrameworkConfig(path).catch(() => ({})) : {}
  return runOptionsFromPreferences(resolvePreferences({ ...global, ...preferencesFromFileConfig(file) }, project))
}

export function startBackgroundServices(deps: BackgroundServiceDeps): BackgroundServices {
  const { env, log } = deps
  const projects = () => listSummaries(env)
  const prefs = () => readPrefs(env)

  /**
   * Start a run nobody is watching. `unattended` is forced on top of the project's settings rather
   * than read from them: it is a property of there being no human at the keyboard, not a
   * preference, and without it every choice gate parks forever on an answer that is not coming
   * (#846). All three background starters go through here, so none can forget either half.
   */
  const startUnattended = async (projectId: string, prompt: string, extra: StartRunOptions = {}) => {
    const options = await resolveProjectRunOptions(projectId, env)
    return deps.startRun(prompt, { ...options, ...extra, unattended: true }, projectId)
  }

  // Discord notifications (#627): fire on new "needs you" items even when no dashboard is open.
  // Two gates — a `DISCORD_WEBHOOK` (where to post) and the per-user preference (whether to). The
  // preference is checked at post time, not at watcher start, so the header toggle takes effect
  // without a daemon restart; the watcher keeps observing while off, so flipping it on starts from
  // now rather than blasting the whole open backlog.
  const webhook = env.DISCORD_WEBHOOK
  const watchers: KeyedWatcher[] = webhook
    ? [
        startKeyedWatcher({
          projects,
          build: items => buildInterventions(items, { dashboardUrl: deps.dashboardUrl }),
          keyOf: interventionKey,
          onNew: async items => {
            if (!discordNotificationEnabled(await prefs(), 'notifyHumanIntervention')) return
            await postInterventionsDiscord(webhook, items).catch(() => {})
          },
        }),
        startKeyedWatcher({
          projects,
          build: buildActivity,
          keyOf: activityKey,
          onNew: async items => {
            if (!discordNotificationEnabled(await prefs(), 'notifyNewActivity')) return
            await postActivityDiscord(webhook, items).catch(() => {})
          },
        }),
      ]
    : []

  // Auto PM (#685/#773): while the queue is dry and there is quota to spare, harvest quick-wins and
  // spike & plan tickets rather than let the day's allowance expire unused.
  const autoPm = startAutoPm({
    projects,
    jobs: AUTO_PM_JOBS,
    enabled: async () => (await prefs()).autoPm === true,
    backlogEmpty: async project => (await findTodoBacklog(project.path)) === undefined,
    activeRuns: project => deps.activeRunCount(project.id),
    // The quota boundary is the gate (#879): auto PM has no budget notion of its own.
    quota: async () => (await deps.quota.read()).boundary,
    // The periodic codebase sweep (#882). The schedule is a file in the project checkout rather
    // than loop state, because unlike the rotation it has to survive a daemon restart: a machine
    // rebooted daily would otherwise sweep every morning and never reach its interval.
    maintenanceDue: async project => maintenanceDue(await readMaintenanceState(project.path), Date.now()),
    recordMaintenance: async project => mergeMaintenanceState(project.path, { sweptAt: new Date().toISOString() }),
    start: async (project, job) => {
      const result = await startUnattended(project.id, job.prompt)
      return result.ok ? result.runId : undefined
    },
    // The daemon promotes the queue, never the agent (#852): the run stays sandboxed in its
    // worktree, and one known file is copied across once it has finished cleanly.
    promote: async (project, runId) => {
      const run = (await listRuns(project.path).catch(() => [])).find(r => r.id === runId)
      // Unknown or still going: not settled, so it is tried again next tick.
      if (!run || run.status === 'running') return { settled: false, promoted: false }
      const outcome = await promoteQueue(project.path, run)
      if (!outcome.promoted) log(`[framework] auto PM: ${outcome.reason} (${runId})`)
      // A finished run is settled either way — one that wrote no queue is not going to start.
      // The exception (a checkout busy with the user's own queue edits) is the callee's to flag.
      const retry = !outcome.promoted && outcome.retry === true
      return { settled: !retry, promoted: outcome.promoted }
    },
    log,
  })

  // Commit the conversations recorded on the main checkout (#912). A run's own worktree already
  // sweeps its transcript on teardown; nothing did the same for a chat held in the checkout itself,
  // so it sat as an uncommitted change until a human noticed. Path-scoped and debounced, and it
  // skips a repo that is mid-rebase or index-locked rather than committing into someone's work.
  const conversationCommitter = startConversationCommitter({ projects, log })

  // The Discord chatbot (#680). Two gates like the watchers above: a `DISCORD_BOT_TOKEN` (a bot can
  // read replies; the #627 webhook cannot) and the per-user `discordBot` preference, read per
  // message so the toggle takes effect without a restart. Unset token means no bot.
  const botToken = env.DISCORD_BOT_TOKEN
  const botEnabled = async () => notificationEnabled(await prefs(), 'discordBot')
  // `resolve` matters: projectId hashes the path string, and `--cwd` reaches us verbatim, so a
  // relative path would hash to an id no project lookup can resolve. Same derivation the runtime uses.
  const homeId = projectId(resolve(deps.cwd))
  const projectPath = async (id: string) => (await projects()).find(p => p.id === id)?.path ?? deps.cwd

  // Send a session's answers back to the channel that asked (#932). The committed conversation
  // (#908) is the source: it holds the settled reply the user would have read, which is what
  // belongs in chat. Bound per run by the bot, since the channel is only known when a message
  // arrives.
  const replyMirror = botToken
    ? startDiscordReplyMirror({
        readConversation: async runId => {
          // A run's transcript lives in the checkout the run used, which for a daemon-spawned run
          // is its own worktree rather than the project root.
          for (const project of await projects()) {
            const meta = (await readLiveMetas(project.path).catch(() => [])).find(run => run.id === runId)
            if (meta) return readConversation(meta.cwd, runId).catch(() => [])
          }
          // No live meta anywhere: the run archived (or its project was removed). The mirror
          // counts these and releases the binding, so per-poll IO stops growing (#941).
          return undefined
        },
        post: (channelId, text) => postMessage(botToken, channelId, text),
        enabled: botEnabled,
        // The discord modules do not prefix their own lines, so the daemon does it for them.
        onLog: message => log(`[framework] ${message}`),
      })
    : undefined

  const bot = botToken
    ? startDiscordBot({
        token: botToken,
        target: async () => {
          const home = (await projects()).find(p => p.id === homeId)
          return home ? { id: home.id, name: home.name } : { id: homeId, name: basename(deps.cwd) }
        },
        liveRun: async id => snapshotLiveRun(id, await projectPath(id)),
        // `via` so the opening turn is filed under Discord too (#917): without it a chat-started
        // session reads as if its first message came from the dashboard and only the follow-ups
        // came from Discord, which is a worse record than attributing none of it.
        start: async (id, text) => {
          const result = await startUnattended(id, text, { via: DISCORD_VIA })
          return result.ok ? result.runId : undefined
        },
        sendMessage: (id, text, runId) => sendMessage(id, text, runId, DISCORD_VIA),
        sendChoice: (id, gateId, pick, runId) => sendChoice(id, gateId, pick, 'user', runId),
        sendStop,
        ...(replyMirror ? { onRunBound: (runId, channelId) => replyMirror.bind(runId, channelId) } : {}),
        enabled: botEnabled,
        ...(env.DISCORD_CHANNEL_ID ? { channelId: env.DISCORD_CHANNEL_ID } : {}),
        onLog: message => log(`[framework] ${message}`),
      })
    : undefined

  // Say so when the token is set but the toggle is not: the bot would otherwise connect and then
  // ignore every message, which reads as broken rather than as off.
  if (botToken) {
    void botEnabled().then(on => {
      if (!on) log('[framework] Discord bot: DISCORD_BOT_TOKEN is set but the `discordBot` preference is off, so it will not answer.')
    })
  }

  return {
    quiesce: () => {
      // The bot's gateway socket is the one connection here that would otherwise hold the event
      // loop open on its own.
      bot?.stop()
      replyMirror?.stop()
      autoPm.stop()
      for (const watcher of watchers) watcher.stop()
      // Stop the timer here, so `flushConversations` below is a single flush past the idle window
      // rather than a wait for a poll that is no longer coming.
      conversationCommitter.stop()
    },
    flushConversations: () => conversationCommitter.flush().catch(() => 0),
  }
}

/**
 * Resume what the last daemon suspended (#923).
 *
 * A run does not outlive its daemon: it is stopped at shutdown and its id + agent session recorded,
 * so a restart continues the same conversation in the same worktree instead of leaving an orphan
 * behind. The state survives the process, which is the #857 direction; the process does not.
 *
 * Capped by age so a machine that has been off for a week does not wake up spending a day's quota
 * on stale work, and the record is cleared as it is read, so a run that fails to resume is not
 * retried on every boot.
 */
export async function resumeSuspendedRuns(
  env: NodeJS.ProcessEnv,
  startRun: BackgroundServiceDeps['startRun'],
  log: (message: string) => void,
): Promise<void> {
  for (const record of await listProjects(undefined, env).catch(() => [])) {
    const suspended = await readSuspendedRuns(record.path).catch(() => [])
    if (suspended.length === 0) continue
    await writeSuspendedRuns(record.path, []).catch(() => {})
    const resumable = resumableRuns(suspended, Date.now())
    const dropped = suspended.length - resumable.length
    const where = basename(record.path)
    if (dropped > 0) log(`[framework] ${dropped} suspended session(s) in ${where} are too old to resume`)
    for (const run of resumable) {
      const options = await resolveProjectRunOptions(record.id, env)
      const result = await startRun(
        RESUME_PROMPT,
        { ...options, unattended: true, continueRunId: run.runId, ...(run.sessionId ? { resumeSession: run.sessionId } : {}) },
        record.id,
      )
      log(
        result.ok
          ? `[framework] resumed session ${run.runId} in ${where}`
          : `[framework] could not resume session ${run.runId}: ${result.error}`,
      )
    }
  }
}

/**
 * What a resumed run is asked to do (#923). The agent comes back with its own session, so it has
 * the whole conversation: the only thing it is missing is why it suddenly stopped mid-task.
 */
export const RESUME_PROMPT =
  'This session was interrupted when The Framework restarted, not by anyone asking you to stop. Look at what you had already done, then carry on from there.'
