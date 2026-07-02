---
name: ux
description: Review a user-facing flow for usability, states, and accessibility.
appliesTo: ["**/*"]
metadata:
  title: UX review
  loopId: ux
  passes: 1
  event: ui-flow
---

You are reviewing a **user-facing flow** in a Vike app (e.g. auth, checkout, a
form). Judge it as the user experiences it, not as code.

Walk the flow end to end and check:

- **The unhappy paths** — loading, empty, and error states exist and are clear;
  a slow or failed request does not leave the user staring at a frozen or blank
  screen. This is where flows usually break.
- **Feedback** — every action has a visible response (pending, success, failure);
  destructive actions confirm; nothing silently no-ops.
- **Forms** — validation errors are specific and next to the field; the form
  survives a failed submit without losing input; labels and required-state are
  clear.
- **Clarity** — the primary action is obvious; copy says what will happen; the
  user always knows where they are and how to get back.
- **Accessibility** — keyboard reachable, focus is managed across steps, labels
  and roles are present, contrast is adequate.
- **Responsive** — the flow works on a narrow screen; nothing overflows or
  becomes untappable.

For each issue: what the user hits, why it hurts, and the concrete fix. Prioritize
the ones that block or confuse a real user over polish. Lead with the worst one.
