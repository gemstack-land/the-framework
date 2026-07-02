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
persona workers wrote, the checklist blocking once and then clearing, the deploy
decision, and the generated `CODE-OVERVIEW.md`.

## What it shows

- **Presets (#115)** — the framework is detected from the project deps (Vike here),
  so the build's workers are that framework's personas plus the shared neutral ones.
- **Bootstrap (#116)** — one scoping question, then an **architect** picks the stack
  and records its choices to the **decisions ledger**, a **build** scaffolds the app
  with the persona workers inside a **runner**, the **full-fledged loop** repeats the
  production-grade checklist until its `{ blockers }` verdict is empty, and a
  **deploy** is decided behind the `DeployTarget` seam.
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
checklist once on missing auth, then decided SSR → dockploy.

Scoped for a first, bounded proof: the production-grade **loop** keeps the scripted
verdict (so the run stays deterministic and cheap), and `deploy` uses `planOnlyTarget`
— it decides + narrates but does not actually ship. Booting/serving the generated app
and real deploy adapters remain (tracked by #109).
