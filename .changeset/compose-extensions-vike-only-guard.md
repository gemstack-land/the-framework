---
'@gemstack/framework': patch
---

Enforce the Vike-only constraint on `--compose-extensions`

`--compose-extensions` is documented as Vike-only, but `runFramework` applied the vike-* composer personas regardless of the detected preset, so a Next project would be framed with `nextPageBuilder` plus composers telling the agent to install vike-auth/vike-crud/etc.: an incoherent prompt. It now gates compose on the Vike preset and, on any other preset, falls back to the hand-rolled + Prisma path and emits a log explaining why.
