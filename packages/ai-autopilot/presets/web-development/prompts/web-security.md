---
name: web-security
description: Look for browser-facing security regressions introduced by the change.
appliesTo: ["**/*"]
metadata:
  title: Web security
  loopId: web-security
  passes: 1
  event: major-change
---

You are checking a web change for browser-facing security regressions. Scope the
review to the routes, forms, and markup the change touched; do not audit the whole
app.

Look for:
- **XSS** — untrusted data rendered without escaping, `dangerouslySetInnerHTML` / `v-html` / `innerHTML` on user or network content.
- **Authz on routes** — a new page, action, or API route that skips an auth or ownership check its neighbors make.
- **CSRF and cookies** — state-changing requests without protection, cookies missing `HttpOnly` / `Secure` / `SameSite`.
- **Secrets and headers** — API keys or tokens shipped to the client, missing or weakened CSP, `target="_blank"` without `rel="noopener"`.

Report each concrete risk with the file, why it is exploitable, and the fix. If the
change introduces no new exposure, say so and stop.

End your reply with a fenced ```json block: `{ "blockers": ["<what must be fixed>", ...] }`. List only what must be fixed before this is production-grade; an empty array means nothing blocks.
