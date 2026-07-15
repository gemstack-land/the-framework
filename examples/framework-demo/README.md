# The Framework — end-to-end demo

One prompt, taken all the way to a **running, deployed app** — offline and
deterministic, in a couple of seconds.

This runs the real product (`@gemstack/framework`'s `runFramework`) with the
built-in **fake driver**: no Claude Code, no model, no API keys. Same code a live
run executes — preset detection, the full-fledged production-grade loop,
deploy — just with scripted agent turns so it is instant
and repeatable. Two things are genuinely real, not narrated:

- **the app boots and serves** — the serve gate starts a real HTTP server and the
  run leaves it running, so the demo `fetch`es it and prints what it served;
- **deploy runs the real `cloudflareTarget` adapter** (over a simulated wrangler),
  so it ends at a real-looking `workers.dev` URL.

## Run it

```bash
pnpm --filter @gemstack/example-framework-demo start
```

## What you see

```
Prompt:  "A paginated orders page backed by an orders table, with sign-in."

--- live narration ---
◆ fake in /tmp/framework-demo-xxxx
  Detected Vike (confidence 2); framing with 3 persona(s)
▶ scope: full — "A paginated orders page backed by an orders table, with sign-in."
  Checking the app is production-grade
  serve: start: node server.js
  serve: fetch http://localhost:50106/ -> 200
  ✗ checklist pass 1: No authentication on the orders page yet
  → improving: No authentication on the orders page yet
  serve: start: node server.js
  serve: fetch http://localhost:50106/ -> 200
  ✓ checklist pass 2: production-grade
▶ deploy: SSR → cloudflare (per-request orders data + server-side auth)
✓ production-grade in 2 pass(es)
▶ your app is running at http://localhost:50106
✓ done

--- outcome ---
  preset detected:  Vike
  production-grade: true (in 2 pass(es))
  deployed to:      cloudflare → https://orders-app.gemstack.workers.dev
  running locally:  http://localhost:50106
  it served:        <!doctype html><meta charset=utf-8><title>Orders</title> <h1>Orders</h1>…
```

The loop does not take the agent's word for "production-grade": it **boots the app
and fetches it** every pass (the `serve:` lines), and blocks until both the review
and the real server pass. When it finishes, the app is left running so you can open
it — that is the localhost link, live until the run stops.

## The real thing

Same flow, driven against Claude Code instead of the fake driver:

```bash
npx @gemstack/framework "a paginated orders page with sign-in"
```

That opens the localhost dashboard, wraps Claude Code as the coding agent, and runs
the identical scope → build → production-grade loop → deploy — writing
real files and, with `--serve`, leaving the real app running behind a preview link.
