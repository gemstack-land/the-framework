# Design: optional skill-scoped tool wrapper (skillTool) over tool()

Spun out of #8 (Q2). #8 decided skills declare tools by **reusing `ai-sdk` `tool()` directly** (a co-located `tools.ts` per skill; the loader merges them and handles namespacing/scoping at composition time). One tool API, full typing, skills stay self-contained.

This issue tracks a possible **skill-scoped tool wrapper** as an *additional* future option, to evaluate if a concrete need appears.

## Idea
A `skillTool()` / `defineSkillTool()` wrapper over `tool()` that bakes skill-level concerns into authoring time:
- namespacing (collision-safe names when many skills load at once)
- scoping/lifecycle (a tool active only while its skill is loaded)
- access to the owning skill's resources/context inside the tool handler

## Why it is deferred (not in #8)
- It is a second tool API to learn and maintain - violates "one way to do it" unless clearly needed.
- The concerns it solves (namespacing, active-only-while-loaded) are solvable at **composition time** in the loader, without burdening every tool author.
- Justified only if tools genuinely need skill context that plain `tool()` cannot carry. Not demonstrated yet.

## Trigger to revisit
Open evidence here if/when: multi-skill loading produces real tool-name collisions the loader cannot cleanly resolve, or a skill's tools need first-class access to that skill's resources at call time.

## Acceptance (if built)
`skillTool(...)` produces tools indistinguishable to the runtime from `tool()` outputs, adds the skill-context/namespacing it promises, and `tool()` remains the default. Tests prove parity + the added scoping.

Gated on the same family alignment as #8; design-only for now.

---
Source: https://github.com/gemstack-land/the-framework/issues/12
