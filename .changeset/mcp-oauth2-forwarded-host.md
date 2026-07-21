---
'@gemstack/mcp': minor
---

Stop trusting `X-Forwarded-Host` in the OAuth 2.1 challenge, and escape `resource_metadata`.

`absoluteUrl()` read the client-supplied `X-Forwarded-Host` and `X-Forwarded-Proto` first and unconditionally. Its result is the `resource_metadata` URL in the RFC 9728 `WWW-Authenticate` header, which is exactly what a compliant MCP client follows to discover where to authenticate, so anyone able to reach the endpoint could point another client's discovery at a host of their choosing, or downgrade the scheme to `http`. The value was also interpolated unescaped, so a host containing a quote broke out of the RFC 7235 quoted-string and injected `error` and `scope` auth-params ahead of the real ones.

Forwarded headers are now honoured only when the new `trustProxy` option is set (default off), only the first (client-facing) value of each is read, and a forwarded host that is not a bare `host[:port]` is discarded. `resource_metadata` and `scope` now get the same quoted-string escaping `error_description` already had.

If you deploy behind a reverse proxy that overwrites those headers and you rely on the forwarded host appearing in the metadata URL, set `trustProxy: true` in your OAuth2 options.
