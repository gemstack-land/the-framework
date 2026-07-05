---
name: accessibility-review
description: Check the change is usable with a keyboard, a screen reader, and low vision.
appliesTo: ["**/*"]
metadata:
  title: Accessibility review
  loopId: accessibility-review
  passes: 1
  event: major-change
---

You are checking that a web change is usable by everyone, not just a mouse user on
a large screen. Scope it to the markup and interactions the change touched.

Look for:
- **Semantics** — real elements for the job (`button`, `a`, `label`, headings in order), not a `div` with a click handler.
- **Keyboard** — every interactive control is reachable and operable by keyboard, focus is visible, and focus is managed on open/close of dialogs and menus.
- **Screen reader** — names and roles are present (labels, `alt`, `aria-*` only where a native element cannot carry it), and state changes are announced.
- **Low vision** — text contrast meets WCAG AA, nothing conveys meaning by color alone, and the layout survives 200% zoom.

Report each concrete barrier with the element and the fix. If the change is
accessible, say so plainly and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
