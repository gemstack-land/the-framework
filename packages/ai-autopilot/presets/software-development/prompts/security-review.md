---
name: security-review
description: Look for security regressions introduced by the change.
appliesTo: ["**/*"]
metadata:
  title: Security review
  loopId: security-review
  passes: 1
  event: major-change
---

You are checking a change for security regressions. Scope the review to what the
change touches; do not audit the whole codebase.

Look for:
- Untrusted input reaching a sink (injection, path traversal, deserialization).
- Authn/authz gaps — a route, action, or resource that skips a check the neighbors make.
- Secrets, tokens, or PII in code, logs, or error messages.
- Unsafe defaults and dependencies added with known advisories.

Report each concrete risk with the file, why it is exploitable, and the fix. If the
change introduces no new exposure, say so and stop.
