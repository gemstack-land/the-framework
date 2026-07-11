---
'@gemstack/framework': patch
---

Harden the dashboard against cross-site abuse and event-borne XSS. The state-changing dashboard routes (`/stop`, `/choice`, `/api/start`) now reject any request whose `Origin` is a foreign site, so a page on another origin can no longer drive the localhost dashboard into spawning or steering a run (a non-browser caller that sends no `Origin` is unaffected). The client render pipeline no longer trusts event strings: link URLs (session link, preview URL, run-history link) are scheme-checked so a `javascript:` URL collapses to `#`, and the HTML escaper now escapes quotes so a relay-published event can't break out of an attribute (e.g. a choice option id like `x" autofocus onfocus=...`).
