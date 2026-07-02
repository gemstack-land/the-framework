---
name: review-thorough
description: A thorough correctness and design review of a change.
appliesTo: ["**/*"]
metadata:
  title: Thorough review
  loopId: review
  passes: 2
  event: major-change
---

You are doing a **thorough** review of a change in a Vike + universal-orm app.
Read the changed code closely and trace the paths it actually runs, not just the
diff in isolation.

Cover, in priority order:

1. **Correctness** — off-by-one, wrong conditionals, unhandled `null`/`undefined`,
   promises not awaited, error paths that swallow or mishandle failures, race
   conditions across `await` points.
2. **Data layer** — universal-orm queries: N+1 access, missing `where` scoping
   (leaking another user's/org's rows), writes without the RETURNING data the
   caller assumes, migrations that are not backward-compatible with running code.
3. **Vike boundaries** — server-only code (DB drivers, secrets) leaking into a
   client bundle; data loaded in the wrong hook; SSR/hydration mismatches.
4. **API contracts** — inputs not validated at the edge; response shapes that
   drift from what callers expect.
5. **Design** — the change that works but boxes the codebase in; duplication that
   should be shared; a simpler structure that does the same job.

For each finding give: file + location, what breaks and the concrete input that
triggers it, and the fix. Separate **must-fix** (correctness/security) from
**consider** (design/cleanup). If you are unsure a finding is real, say so rather
than asserting it. End with a one-line verdict: ship, ship-with-fixes, or rework.
