# Epic: The AI framework — turnkey end-to-end AI orchestration for building software (web-app first)

## The bet

A **turnkey** AI framework for building web apps. `npm install` and it works: prompts, personas, and flows already wired, opinionated about the stack (Vike/Next + universal-orm). Claude Code for the web, supercharged, not low-level agent infra you assemble yourself.

This extends the ai-autopilot thesis (#97, closed) from "the seed" (personas + runner + surfaces, all shipped) to the full product. Flue/Pi/Omnigent are generic harnesses we sit on; none ship the web-app-specific layer. That layer is the moat.

## Scope (agreed 2026-07-02)

**Agnostic core + domain presets.** The engine (the loop + the state layer: decisions ledger, CODE-OVERVIEW, review/quality/security triggers) is language- and framework-agnostic and runs on any codebase; most prompts are generic. The web-app-specific value (Vike/Next personas, UI-flow => QA+UX) sits on top as a **preset**. Web-app is the flagship preset and the launch wedge, we lead the story there, not with "works on any code" (the crowded/generic pitch). Non-web presets (e.g. Python) are possible later.

Execution model (updated 2026-07-03, see #165): the shipped product **wraps the Claude Code CLI** and drives it as a black-box **outer loop** — we send prompts, read the code it produced, and gate on outcomes (builds / serves / review-passes / PR-exists); we never reach inside its loop. This lets users spend a Claude Max subscription and keeps us provider-swappable (Codex/opencode behind the same driver adapter). `@gemstack/ai-sdk` remains the lower-level, provider-agnostic engine (pay-per-token) that the orchestration primitives and any non-wrapped paths run on — it is the engine, not the shell. Guardrails (swappable driver, own the event stream) live in #165. (Verify Claude Code ToS before relying on the subscription path.)

## Positioning

- **Turnkey**: zero wiring. `npm install` and go.
- **Opinionated**: knows Vike/Next + universal-orm. Data stays separate (universal-orm), as agreed.
- **Open source, collaborative**: the community grows the prompt/flow library via PRs, and it stays turnkey for everyone.
- Name (decided 2026-07-03): **"The Framework"**, tagline "The (AI) Framework", domain `the-framework.ai`, npm `@gemstack/the-framework` (`npm i -g`). Positioning shorthand: "Vite for AI" (turnkey/zero-config) vs competitors' "webpack for AI" (low-level).

## Children (buildable, in priority order)

Status (2026-07-02): the whole state layer + loop + bootstrap are built and merged. Only #115 (deliberately scope-open) and the infra-gated pieces remain.

- [x] #111 — **Built-in prompts library** (P0, first): review (TLDR + thorough), code quality, security audit, refactoring, UX, QA, knowledge base / business context. The v1 and the main OSS contribution surface.
- [x] #112 — **Decisions bookkeeping** (P1): persist rejected ideas so the AI stops re-pitching them. Novel; nobody ships it.
- [x] #113 — **"The loop"** (P1): event to prompt-chain policy. A major change fires review + code quality + security; a new UI flow fires QA + UX. Runs on the autopilot Supervisor + surfaces.
- [x] #114 — **Scale mode** (P2): maintain a `CODE-OVERVIEW.md` so the agent navigates a large codebase fast.
- [x] #115 — **Web-app preset (Next.js + Vike)**: the flagship domain preset on top of the agnostic core; framework-specific personas/prompts at the persona/prompt/loop layer only. (Scope deliberately open pending v1 traction.)
- [x] #116 — **Bootstrap mode** (P-high): zero to a production-grade app, scope prompt + full-fledged loop + dev-style narration. Likely our best first-run / acquisition hook. (Framework side done #120-123; only the live capstone #124 is infra-gated.)
- [ ] #165 — **Presentation layer**: headless server + two thin UIs (CLI + localhost web chat) on one backend, over the existing `EventStream`. Open decision: own shell vs. sit on opencode.

## Parked (not children yet)

- **Paid-hosting business model** (decision, not a buildable issue). (Product name decided 2026-07-03 — see Positioning.)

Foundation: #97.

## Landscape + positioning (validated 2026-07-02, competitive scan)

The "prompt collection + workflow + OSS PRs" positioning is already crowded: BMAD, GitHub Spec Kit, OpenSpec, GSD, Superpowers (170k+ combined stars) all sit there, betting on **spec-driven** dev. Cloudflare published their internal review-orchestration system (runs "the loop" at scale in CI; found AGENTS.md-style instruction files rot fast, so they built a reviewer that detects material changes and forces updates). Claude Squad / Baton orchestrate parallelism, not quality loops. LangGraph/CrewAI = infra layer, not competitors.

So: **prompts are table stakes / the on-ramp, not the moat.** Lead the product with the auto-maintained **state layer + the loop**, which is the whitespace:
- Decisions bookkeeping (#112) — nobody has a rejected-ideas ledger. Most original.
- Semantic event-triggered loops (#113) — others are command-driven or CI-every-PR, not change-type-aware.
- Browser-agent QA on UI changes — nobody ships it inside a workflow framework (near-standalone).
- Auto-maintained CODE-OVERVIEW.md (#114) — validated by Cloudflare's "instructions rot" finding.

Our bet (review/QA loops + persistent state) differs from the spec-driven pack. Lead with it so we don't read as "the sixth spec framework."

**Which agent do we orchestrate?** (updated 2026-07-03) The product **wraps the Claude Code CLI** as an outer loop; `@gemstack/ai-sdk` is the underlying provider-agnostic engine, not the shell. Wrapping a vendor CLI does raise a real "could Anthropic eat this layer" risk — the #165 guardrails are how we mitigate it: (1) the wrapped CLI is a **swappable driver adapter** (Claude Code first, Codex/opencode behind the same seam), so no single vendor is load-bearing; the only hard dependency is the code/outcome seam we own; (2) we **own our own event stream** (the Supervisor already emits it) rather than betting the UX on any one vendor's UI. The defensible value stays in the loop + state layer + team/multiplayer, not the shell.

**Business model:** keep the OSS local version from being so complete that hosting is pointless. The paid wedge is team/multiplayer (shared decision log, review history, org-wide business context), not "we run it for you."

---
Source: https://github.com/gemstack-land/the-framework/issues/110
