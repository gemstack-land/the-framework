---
'@gemstack/framework': minor
---

Serve the usage panel's numbers: an `onQuota` RPC returning the account's quota windows plus where the consumption limits stand, backed by a quota source the daemon polls for its whole life (the per-run guard dies with its run, but the panel has to show the account while nothing is running). A host with no agent to ask reports it has no reading rather than an empty one.
