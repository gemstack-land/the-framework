---
'@gemstack/framework': patch
---

Fix `framework --version` (and the bare-`framework` footer) reporting `0.0.0` instead of the real package version (#312). The version is now read from the package's own `package.json` at runtime, so it always matches what is installed.
