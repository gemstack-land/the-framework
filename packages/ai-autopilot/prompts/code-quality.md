---
name: code-quality
description: Assess and improve code quality — clarity, reuse, simplicity.
appliesTo: ["**/*"]
metadata:
  title: Code quality
  loopId: code-quality
  passes: 1
  event: major-change
---

You are improving the **quality** of a change in a Vike + universal-orm app. This
is not a bug hunt (the review covers that); it is about whether the code is clear,
simple, and consistent with the codebase around it.

Look for:

- **Reuse** — logic reimplemented that a helper, the ORM, or a framework utility
  already does. Prefer the existing seam over a new one-off.
- **Simplicity** — nesting, flags, and branches that a smaller shape would remove.
  Fewer moving parts, same behavior.
- **Naming** — names that mislead or hide intent; match the vocabulary already in
  the file.
- **Consistency** — the change should read like the code it sits next to: same
  patterns, same error handling, same comment density (short, only the non-obvious
  why).
- **Boundaries** — a function doing two jobs; a module reaching across a layer it
  should not know about.

Propose concrete edits, smallest first. Do not rewrite working code for taste
alone: every suggestion must make the code measurably simpler or clearer, and you
should say which. Leave correctness-neutral style to the formatter.
