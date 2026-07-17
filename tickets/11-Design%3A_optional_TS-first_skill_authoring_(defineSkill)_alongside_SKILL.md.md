# Design: optional TS-first skill authoring (defineSkill) alongside SKILL.md

Spun out of #8 (Q1). #8 decided the **primary** skill manifest format is `SKILL.md` frontmatter (matches the shipped `boost/skills` convention + Anthropic Agent Skills; portable; natural progressive disclosure). This issue tracks a possible **TS-first authoring path** as an *additional* option later, not a replacement.

## Idea
Offer a typed `defineSkill({ name, description, instructions, tools, resources })` (or a `Skill` class) that produces the same runtime skill object the `SKILL.md` loader produces. Two front doors, one runtime.

## Why someone might want it
- Full type safety + IDE support at authoring time.
- Tools can be real `tool()` objects inline (no name/path resolution).
- Native composition with the `Agent` class for code-only projects.

## Why it is deferred (not in #8)
- Diverges from the Anthropic shape, so TS-authored skills are not portable out the way `SKILL.md` bundles are. The markdown path is the moat.
- Long instructions read poorly as TS template strings.
- Progressive disclosure is less natural (the module loads at import).
- Adds a second authoring surface to maintain - only worth it if there is real demand.

## Acceptance (if built)
`defineSkill(...)` yields a skill object indistinguishable to the runtime/composition layer from one loaded via `SKILL.md`, with tests proving parity. Markdown remains the documented default; TS-first is opt-in.

Gated on the same family alignment as #8; design-only for now.

---
Source: https://github.com/gemstack-land/gemstack/issues/11
