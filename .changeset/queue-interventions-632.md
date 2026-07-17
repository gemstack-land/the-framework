---
'@gemstack/framework': minor
---

Add the Queue's cross-project "needs you" projection (#632, part of #624): `buildInterventions` rolls up every registered project's open, non-draft PRs (via `gh pr list`, degrading to empty with no remote / no gh), newest first, and exposes them over a new `onInterventions()` dashboard read. This is the first slice of the interventions queue — proposals and finished work both surface as PRs to review or close.
