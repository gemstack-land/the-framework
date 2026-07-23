---
"@gemstack/framework": patch
---

fix(framework): set the daemon token cookie SameSite=Lax so the "a device I have" connection hop works

The non-loopback bind guard (#1051) set the fw_daemon cookie SameSite=Strict. Connecting to a saved device (#1052) is a cross-origin top-level navigation, and a Strict cookie set during that navigation is withheld by the browser on the immediate redirect to the clean path, so the device connect landed on a 401. Lax still rides top-level GET navigations, and CSRF protection is unchanged (the same-origin check still fronts /_telefunc).
