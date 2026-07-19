import type { BootstrapEvent } from '@gemstack/ai-autopilot'
import type { DriverEvent, DriverRateLimit } from './driver/index.js'
import { pickedIds, type ChoiceOption, type FrameworkEvent } from './events.js'

// The terminal surface for the run's event stream: render one {@link FrameworkEvent} as one
// human-readable line. This is the CLI's counterpart to the dashboard's read-model
// projections (run-view.ts) — a pure formatter over the same union, kept out of events.ts so
// the event contract stays a plain data module (and browser-safe for the client bundle).

/** Render a {@link FrameworkEvent} as one human-readable line (terminal surface). */
export function formatFrameworkEvent(event: FrameworkEvent): string {
  switch (event.kind) {
    case 'session':
      return `◆ ${event.fake ? 'fake' : event.driver} in ${event.workspace}${
        event.sessionLink ? ` — ${event.sessionLink}` : ''
      }`
    case 'session-update':
      return `  session ${event.sessionId}${event.sessionLink ? ` — ${event.sessionLink}` : ''}`
    case 'system-prompt':
      return `  system prompt sent (${event.text.length} chars)`
    case 'preview':
      return `▶ your app is running at ${event.url}`
    case 'browser-stream':
      return `◆ browser preview: http://127.0.0.1:${event.port}/stream`
    case 'log':
      return `  ${event.message}`
    case 'view':
      return `▶ view: ${event.title}`
    case 'session-name':
      return `  session: ${event.name}`
    case 'ready-for-merge':
      return `✓ ready for merge`
    case 'settled':
      return `◆ done for now — waiting for your next message`
    case 'usage': {
      const turns = `over ${event.turns} turn${event.turns === 1 ? '' : 's'}`
      // No price to show: report the tokens the agent *did* report, rather than a
      // `$0.0000` that would read as free (#540).
      if (event.costUsd === undefined) {
        const tokens = event.inputTokens + event.cacheReadTokens + event.outputTokens
        return `  tokens: ${tokens.toLocaleString('en-US')} (${event.outputTokens.toLocaleString('en-US')} out) ${turns} — no price reported`
      }
      return `  spend: $${event.costUsd.toFixed(4)}${event.budgetUsd ? ` / $${event.budgetUsd}` : ''} ${turns}`
    }
    case 'modes': {
      const shown = event.all.map(m => `${event.active.includes(m) ? '[x]' : '[ ]'} ${m}`).join('  ')
      return `  modes: ${shown}`
    }
    case 'choice': {
      const mark = (o: ChoiceOption) =>
        event.multi ? (o.default ? '[x]' : '[ ]') : o.id === event.recommended ? '●' : '○'
      const opts = event.options.map(o => `    ${mark(o)} ${o.label}`).join('\n')
      return `? ${event.title}\n${opts}`
    }
    case 'choice-resolved':
      return `  ✓ chose ${pickedIds(event.picked).join(', ') || '(none)'} (${event.by})`
    case 'driver':
      return formatDriverEvent(event.event)
    case 'bootstrap':
      return formatBootstrapEvent(event.event)
    case 'end':
      return event.ok ? '✓ finished' : event.stopped ? '■ stopped' : `✗ failed: ${event.detail ?? 'unknown error'}`
  }
}

function formatDriverEvent(event: DriverEvent): string {
  switch (event.type) {
    case 'start':
      return `  › prompt: ${truncate(event.prompt, 140)}`
    case 'text':
      return `    ${truncate(event.text)}`
    case 'action':
      return `    · ${event.label}`
    case 'result':
      return `  ‹ turn complete`
    case 'rate-limit':
      return `    ${formatRateLimit(event.limit)}`
    case 'error':
      return `  ! agent error: ${event.message}`
    case 'notice':
      return `  ~ ${event.message}`
  }
}

/** Quiet on the happy path: only worth a line when the quota is actually tight. */
function formatRateLimit(limit: DriverRateLimit): string {
  const resets = new Date(limit.resetsAt).toISOString()
  if (limit.status === 'rejected') return `✗ quota exhausted (${limit.window}), resets ${resets}`
  if (limit.status === 'allowed_warning') return `! quota running low (${limit.window}), resets ${resets}`
  return `· quota ${limit.status} (${limit.window}), resets ${resets}`
}

function formatBootstrapEvent(event: BootstrapEvent): string {
  switch (event.type) {
    case 'scope':
      return `▶ scope: ${event.scope} — "${event.intent}"`
    case 'narrate':
      return `  ${event.message}`
    case 'build':
      return `    build/${event.event.type}`
    case 'checklist':
      return event.passing
        ? `  ✓ checklist pass ${event.pass}: production-grade`
        : `  ✗ checklist pass ${event.pass}: ${event.blockers.join('; ')}`
    case 'improve':
      return `  → improving: ${event.blockers.join('; ')}`
    case 'deploy':
      return `▶ deploy: ${event.plan.render.toUpperCase()} → ${event.plan.target} (${event.plan.reason})`
    case 'done':
      return `✓ ${event.result.productionGrade ? 'production-grade' : 'prototype'} in ${event.result.passes} pass(es)`
  }
}

function truncate(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}
