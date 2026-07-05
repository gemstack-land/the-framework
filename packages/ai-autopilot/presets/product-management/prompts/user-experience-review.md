---
name: user-experience-review
description: Check the change serves the user, not just the ticket.
appliesTo: ["**/*"]
metadata:
  title: User experience review
  loopId: user-experience-review
  passes: 1
  event: major-change
---

You are reviewing a substantial change from the user's side. Scope it to the flows the
change touches; do not audit the whole product.

Look at:
- The primary flow — is it clear, does it take the fewest steps, does it tell the user what happened?
- The unhappy paths — loading, empty, error, permission-denied, and slow-network states a real user will meet.
- Consistency — does it match the patterns and wording the rest of the product already uses, or fork a second way?

Report each concrete experience problem with where it shows up and the fix. If the
change gives the user a clear, complete experience, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
