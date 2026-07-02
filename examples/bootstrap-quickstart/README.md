# Bootstrap quickstart (capstone)

The whole `@gemstack/ai-autopilot` AI-framework epic in one offline flow — from a
project's dependencies to a scaffolded, production-grade, deploy-decided app.

```
detect framework (preset)
  → Bootstrap: scope → architect → build → full-fledged loop → deploy
  → scale mode: CODE-OVERVIEW.md
```

## Run it

```bash
pnpm --filter @gemstack/example-bootstrap-quickstart start
```

No API key: `AiFake` scripts the model and `FakeRunner` is an in-memory sandbox,
so the run is deterministic. You'll see the narration stream live, the files the
persona workers wrote, the checklist blocking once and then clearing, the app
shipped to a Cloudflare URL, and the generated `CODE-OVERVIEW.md`. The deploy runs
the real `cloudflareTarget` adapter over a simulated `wrangler`, so the whole flow
ends at a live-looking URL with no credentials.

## What it shows

- **Presets (#115)** — the framework is detected from the project deps (Vike here),
  so the build's workers are that framework's personas plus the shared neutral ones.
- **Bootstrap (#116)** — one scoping question, then an **architect** picks the stack
  and records its choices to the **decisions ledger**, a **build** scaffolds the app
  with the persona workers inside a **runner**, the **full-fledged loop** repeats the
  production-grade checklist until its `{ blockers }` verdict is empty, and a
  **deploy** is decided and shipped through the `DeployTarget` seam — here the real
  `cloudflareTarget` (SSR → Workers), run over a simulated `wrangler` offline.
- **Surfaces (#100/#120)** — every phase streams as narration over the generic
  `launchAutopilot<BootstrapEvent, BootstrapResult>` handle.
- **Scale mode (#114)** — `CODE-OVERVIEW.md` is generated from the scaffold.

## Live verification (#124)

The offline run above verifies the flow structurally. `src/live.ts` runs the same
flow for real — a real model via `@gemstack/ai-sdk` and a real `LocalRunner`
workspace on the host filesystem, so the architect, the build workers, and the
deploy decision are all model-driven and the workers write **real files to disk**:

```bash
ANTHROPIC_API_KEY=sk-... pnpm --filter @gemstack/example-bootstrap-quickstart start:live
# override the model with any provider ai-sdk knows:
GEMSTACK_MODEL=anthropic/claude-haiku-4-5-20251001 ... start:live
```

Swapping the fakes (`AiFake` + `FakeRunner`) for a real model + `LocalRunner` is the
only difference from `main.ts`; the orchestration is identical. A sample live run
scaffolded a 9-file Vike + universal-orm orders app (schema + migration, `pages/orders/`
with `+Page`/`+data`/`+config`, a UI-intent renderer) from the intent, blocked the
checklist once on missing auth, then decided SSR → Cloudflare.

### Real deploy to Cloudflare

Add a Cloudflare token and the live run ships for real — `cloudflareTarget`
installs, builds, and deploys the scaffold (Workers for SSR, Pages for SSG/SPA)
and reports the live URL:

```bash
ANTHROPIC_API_KEY=sk-... \
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_PROJECT=my-app \
pnpm --filter @gemstack/example-bootstrap-quickstart start:live
```

Without `CLOUDFLARE_API_TOKEN` the deploy falls back to `planOnlyTarget` (decide +
narrate, no ship), so the live run works with only a model key. Note the deploy
runs `npm install && npm run build` against the scaffold, so a real ship needs the
generated app to actually build — that is what the full-fledged loop (and an
opt-in `serveCheck`, below) are for.

Scoped for a bounded proof, the production-grade **loop** keeps the scripted verdict
so the run stays deterministic and cheap; making the checklist a real reviewer agent
is the natural follow-up.

### Giving the loop teeth: `serveCheck`

The scripted checklist only *asks* whether the app is production-grade. To gate a pass
on whether the app actually **boots and serves**, compose a `serveCheck` into the
checklist — it runs install → start the dev server → `preview` → fetch a health path,
turning failures into blockers the improve loop then fixes:

```js
import { serveCheck, mergeChecklists, loopChecklist } from '@gemstack/ai-autopilot'

// A pass is production-grade only when the prompt says so AND the app really runs.
checklist: mergeChecklists(
  loopChecklist({ loop }),
  serveCheck(session, { install: 'npm install', serve: 'npm run dev', port: 3000 }),
),
```

It's left out of the default live run because a model-scaffolded app may not install or
boot first try (that's the loop's job to fix) — enable it when you want the run to prove
the app serves, not just that files were written.
