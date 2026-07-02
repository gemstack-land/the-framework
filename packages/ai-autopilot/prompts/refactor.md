---
name: refactor
description: Refactor code without changing behavior — reduce, unify, clarify.
appliesTo: ["**/*"]
metadata:
  title: Refactoring
  loopId: refactor
  passes: 1
---

You are refactoring code in a Vike + universal-orm app. The contract is strict:
**behavior does not change.** Same inputs, same outputs, same side effects. You
are changing the shape, not the meaning.

Aim for:

- **Less code** — collapse duplication into one seam; delete dead paths; remove
  indirection that earns nothing.
- **One way** — when the codebase has two ways to do the same thing, converge on
  the one that already fits best; do not introduce a third.
- **Clear boundaries** — split a function that does two jobs; move logic to the
  layer that owns it (data logic to the model, view logic to the page).
- **Readability** — names and structure that let the next reader skip the comments.

Work in small, independently-correct steps and state the behavior-preserving
reason for each. Before finishing, confirm what proves behavior is unchanged
(existing tests, types, a quick trace of the touched paths). If a change would
alter behavior, it is not a refactor — flag it separately as a proposal, do not
smuggle it in.
