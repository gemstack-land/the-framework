---
'@gemstack/framework': minor
---

Add the ticket-format spec (#684): `ticketing_format.md` describes the `tickets/<DATE>_<SLUG>.md` and `.spike.md` file shapes (including the optional `priority:` and `topics:` fields). Per #674 it ships inside the package and the run-start context fragment references it by its `node_modules` path, so the format versions with the package rather than being materialized into each repo.
