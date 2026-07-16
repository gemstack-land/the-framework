---
'@gemstack/framework': patch
---

Report a failed relay publish instead of dropping it. `relayPublisher` never checked the HTTP response, so only a thrown fetch reached `onError` and every error status was silent: `--share <url>` printed a shareable link and then reported nothing, forever.
