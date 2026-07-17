# Epic: Collaboration layer — agents as teammates in the comms layer

> Tracked-but-later (**Phase 1**). Do not build before the MVP ships. This captures a team-discussion direction so it is not lost; it is not scheduled work yet.

## Vision

Agents get real identities and presence and live in the company's communication layer (chat, threads, later voice/video) as peers, not as a passive sidebar assistant. You add an agent to a channel, `@mention` it, or DM it. A manager agent reads a channel, DMs specialist agents, they coordinate, reply in-channel, and maintain the knowledge base, tasks, and issues. This is the "then extend in this direction" step that sits on top of the autonomous core, not instead of it.

## Decided direction

- Keep the integration seam simple and generic so Slack / Discord / others are all easy to add. Start with a single bot user that acts as a channel for multiple agent personas (no per-persona accounts needed).
- Realtime via Telefunc (Room API).
- Agentic-PM entry point: a team chats to consensus, then `/plan-from-chat` (or "@ai create a plan from this chat") turns the discussion into a plan/queue. Nudge the agent to be succinct.

## Open questions

- Multi-user chat mapping: how per-user TODO/state maps when one bot user serves many humans.
- Voice/video participation (hosted-only, needs webrtc infra).
- Compete vs collaborate with the main competitor (affects how much of this we build ourselves).

## Related

- Depends on #605 (daemon + gateway split) for where the agents actually run.
- #454 (syncing UI <-> data): the realtime / source-of-truth substrate this rides on.
- #462 (ticketing / PM): the tasks and issues agents maintain from chat.

---
Source: https://github.com/gemstack-land/gemstack/issues/606
