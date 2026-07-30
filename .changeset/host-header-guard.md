---
'@gemstack/the-framework': patch
---

The dashboard's loopback Telefunc mount now validates the `Host` header (#1387). Before this, a DNS-rebinding page could reach the daemon's run-starting RPCs from the victim's browser: the origin check passed Origin-less requests, and nothing pinned `Host` to a loopback name. Requests whose `Host` is not a loopback address are refused.
