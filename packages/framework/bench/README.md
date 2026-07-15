# Benchmarks

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
