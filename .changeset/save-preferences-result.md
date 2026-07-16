---
'@gemstack/framework': patch
---

Fix `savePreferences` rejecting the RPC when the underlying write fails. The telefunction advertises a `{ ok: false, error }` result and already returns it for the not-enabled case, but a failed disk write threw straight through, so the client saw a rejected call instead of the typed error. The write is now wrapped, so both failure modes return `{ ok: false }` and the client handles them the same way.
