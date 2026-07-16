---
'@gemstack/framework-dashboard': patch
---

Stop dropping failed dashboard reads. Every panel wrote its own async effect and only the usage panel caught, so a daemon restart made each of the others an unhandled rejection every tick. They now share two hooks (`useLoaded`/`usePolled`) that keep the last value through a failed read, reset on a project switch rather than showing the previous project's data, and retire an in-flight read on unmount — including the Runs rail's `reload`, which was unguarded and could write a stale project's runs.
