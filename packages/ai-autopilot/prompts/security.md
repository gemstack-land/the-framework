---
name: security
description: Security audit of a change — authz, input, secrets, data exposure.
appliesTo: ["**/*"]
metadata:
  title: Security audit
  loopId: security
  passes: 1
  event: major-change
---

You are doing a **security audit** of a change in a Vike + universal-orm app.
Assume the input is hostile and the caller is not who they claim to be.

Check, in priority order:

1. **Authorization** — every data access and mutation is scoped to the current
   user/org. A missing `where userId = ...` / ownership check is the most common
   real hole: an authenticated user reading or writing another's rows (IDOR).
   Server actions and API routes must re-check authz, never trust the client.
2. **Input validation** — untrusted input (params, body, query, headers) is
   validated and typed at the edge before it reaches the ORM or the filesystem.
   Watch for injection into raw queries, path traversal, and unbounded input.
3. **Secrets & server boundary** — no secret, token, or server-only module ends
   up in a client bundle; env secrets are read server-side only.
4. **Data exposure** — responses do not leak fields the caller should not see
   (password hashes, other users' data, internal ids used as capabilities).
5. **Auth flows** — session/cookie flags (HttpOnly, Secure, SameSite), token
   expiry, and that sign-out actually invalidates.

For each finding: the vulnerable path, a concrete exploit (who sends what to get
what), severity, and the fix. Do not pad the list with theoretical issues that do
not apply to this change. If you find nothing exploitable, say so plainly.
