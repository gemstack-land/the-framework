# Benchmarks

## meta-select routing (#502)

Does the AI meta-select step (auto-picking a domain preset for a task, `src/meta-select.ts`) route to the policy a human would pick? Rom's doubt on #485 is that a generic "pick the build policy" instruction boxes the model without a clear goal. So measure it before we keep it.

The harness runs a hand-labeled corpus (`src/meta-select-bench.ts`, `META_SELECT_BENCH_CASES`) through `metaSelect` and reports three numbers:

- **accuracy** — correct picks / total.
- **over-fire** — picked a preset when `none` (plain flow) was the right answer. This is the "it boxes the AI" failure Rom is worried about.
- **miss / misroute** — fell back to `none` when a preset fit, or picked the wrong preset.

The corpus has two bands: clear-cut cases (does it do the easy thing) and an **adversarial** band that actually stresses the doubt — vague / unclear-goal intents where `none` is right (so over-fire shows), trap-`none` intents dressed in domain keywords, genuinely cross-domain intents (scored against a set of defensible picks via `alsoAcceptable`), and mismatched intent-vs-workspace signals.

The scoring is pure and unit-tested (`src/meta-select-bench.test.ts`); this runner just drives a live model.

### Run it

```bash
pnpm --filter @gemstack/framework build          # dist/ must exist
pnpm --filter @gemstack/framework bench:meta-select
MODEL=claude-haiku-4-5-20251001 pnpm --filter @gemstack/framework bench:meta-select
```

Needs the `claude` CLI installed and logged in (it drives a real model). Output is a per-case ok/XX list plus the summary.

### Reading the result (the #502 decision)

- High accuracy **and** low over-fire → the step earns its keep; the router adds value.
- Low accuracy or high over-fire → the generic step is boxing the model; narrow it to clear-goal cases or drop it.

The corpus is small and its labels are arguable on purpose (each case carries a `why`). Grow it with real routing the model gets wrong.

## architect prompt (#485 / #499)

Does the architect prompt (`architectPrompt` in `src/steps.ts`) pick a sane stack for the app, give the honest tradeoffs it promises, and stay unbiased? #499 already had to strip a Vike nudge from it, so this benchmark guards the same trust concern.

The harness (`src/architect-bench.ts`) runs a labeled corpus of app ideas through `driverArchitect` and reports:

- **sane stacks** — for apps whose *type* dictates the family (a CLI is not a web app, a mobile app is not Next.js), did it pick something in the acceptable set and nothing clearly wrong.
- **honest tradeoffs** — how often the plan carried a pro **and** a con **and** a rejected alternative (the architect prompt asks for all three).
- **framework balance** — across genuinely framework-agnostic web apps, which frontend framework it picked. A heavy skew to one (e.g. Vike) is the bias #499 was about.

```bash
pnpm --filter @gemstack/framework build
pnpm --filter @gemstack/framework bench:architect
```

Same requirements as above (a logged-in `claude` CLI). Scoring is pure and unit-tested; the runner just drives the model.
