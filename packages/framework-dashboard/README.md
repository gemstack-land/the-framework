# @gemstack/framework-dashboard (spike)

De-risking spike for the dashboard rebuild (#405 / #406). Rebuilds The Framework's
localhost dashboard on **Vike (SPA) + React + Tailwind v4 + shadcn/ui + Telefunc**,
side-by-side with the current `page.ts` MVP page (which is untouched).

It is a **projection of the same files the daemon writes** — no daemon process, no
IPC:

- **Projects sidebar** — a Telefunc RPC (`server/projects.telefunc.ts`) over the
  global registry (`@gemstack/framework`'s `listProjects`).
- **Read model** — Telefunc RPCs (`server/reads.telefunc.ts`) for run history, a
  run's replay, the surfaced PLAN/TODO docs, and the committed `LOGS.md`.
- **Live event stream** — a Telefunc Channel (`server/events.telefunc.ts`) tailing
  the selected project's `.the-framework/events.jsonl`; each new line becomes one
  `channel.send(event)`, and the client `.listen()`s. Serialization, type
  validation, and reconnect come from Telefunc.

## Run it

```bash
pnpm --filter @gemstack/framework build   # the dashboard reads its registry + types
pnpm --filter @gemstack/framework-dashboard dev
# open http://localhost:4300
```

Populate a project to watch (offline, no Claude usage):

```bash
# from packages/framework
node dist/bin.js --fake --no-dashboard --autopilot --cwd /tmp/demo-app
node dist/bin.js --cwd /tmp/demo-app --port 4399   # registers it, then Ctrl-C the daemon
```

## Scope

Thin slice only — no feature parity with the MVP page. The point is to judge the
component model + shadcn + Telefunc wiring. Full port + per-project live streaming
(#393) + production serving (daemon serves the built bundle) are later phases of #405.
