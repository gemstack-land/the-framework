---
'@gemstack/ai-autopilot': minor
---

Export the vike-rbac / vike-crud / vike-shell composer personas individually

`vikeAuthComposer` and `vikeDataModeler` were re-exported individually from the package root, but their three peers `vikeRbacComposer`, `vikeCrudComposer`, and `vikeShellComposer` were only reachable through the `vikeExtensionPersonas` array. They are now exported individually too, so a consumer building a custom persona roster can cherry-pick any of the built-in extension composers uniformly. No runtime change.
