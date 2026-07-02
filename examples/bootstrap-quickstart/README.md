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

## Live verification (infra-gated)

The framework pieces verify offline here with fakes. The honest "zero to a running
app" proof needs a live model + `LocalRunner` producing a real app end to end —
that half is infra-gated (#124). Swapping the two fakes for a real model and
`LocalRunner` is the only code change; the flow is identical.
