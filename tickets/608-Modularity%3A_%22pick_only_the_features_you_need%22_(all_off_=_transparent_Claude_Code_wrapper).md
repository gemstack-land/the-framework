# Modularity: "pick only the features you need" (all off = transparent Claude Code wrapper)

> Exploration, captured from team discussion. Flagged as "only if clearly worth it" and "don't let architecture slow us down." Not scheduled; this is here to think it through, not to build yet.

## Idea

Make The Framework fully opt-in at the feature level: the user picks only the features they want. Turn everything off and The Framework is 100% exactly like Claude Code, a transparent wrapper that adds nothing. Each feature (built-in system prompt, autopilot / queue, presets, gates, knowledge docs, browser, ...) is an independent toggle on top of that passthrough base. Possibly a little composability too, but only the smallest amount that clearly pays for itself.

## Why it matters

- A transparent-passthrough baseline is the most honest "0% lock-in" story: adopt one feature at a time, always fall back to plain Claude Code.
- It de-risks adoption and reinforces the open-source positioning.

## Open questions / caution

- Keep it simple. The explicit ask was to avoid complex architecture that slows us down; pursue only if the value is clear.
- Granularity: what is the right unit of "a feature"? We already have coarse toggles (`--vanilla` drops the built-in prompt, `--eco-*` drop sections, `--no-todo-loop`, ...). This may be mostly unifying and surfacing those as one clean "features" model rather than new machinery.
- This is a lighter, toggle-level take, not a return to the extension SPI.

## Related

- #190 (closed): the earlier "Vike-style extensions" modularity attempt, since removed.
- The existing `--vanilla` / `--eco-*` / `--no-todo-loop` flags are the seed of a feature-toggle model.

---
Source: https://github.com/gemstack-land/the-framework/issues/608
