---
'@gemstack/framework': minor
---

Make the "Needs you" (human intervention) notifications a real toggle (#627). It was always-on before; now it is a default-on `notifyHumanIntervention` preference, so it can be turned off like the other categories. Gates both the browser notification and the daemon's Discord delivery on the category (default on) in addition to the delivery method.
