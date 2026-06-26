---
"@gemstack/mcp": patch
---

Quality + docs pass for mcp:

- OAuth: reject an empty bearer token (`Authorization: Bearer ` with no value) up front with a `401 invalid_token` instead of forwarding an empty string to `verifyToken`.
- Errors thrown when a `@Handle` dependency fails to resolve now chain the original via `{ cause }`.
- Documented `McpResponse.text/json/error` (and when to prefer `error()` over throwing); neutralized framework-specific wording in the OAuth core docs.
- README: completed the OAuth 2.1 section (a real `jose`-based `verifyToken`, and that `oauth2McpMiddleware` + `registerOAuth2Metadata` must both be wired), softened the origin framing.
