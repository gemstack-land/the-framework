---
"@gemstack/framework-dashboard": minor
---

Client connection profiles + "a device I have" in the gear (#1052). The "Run on" submenu gains an "A device I have" section: Local (this machine's own daemon), your saved daemons, and "Add a device". These rows diverge from the driver rows above them: a driver row writes a preference, a device row NAVIGATES the browser to that daemon's origin carrying its token, where the same-origin bootstrap re-authenticates from the cookie it sets. "Add a device" takes the full `http://host:port/?token=…` URL a box prints on its network bind (any reachable host: LAN IP, tailnet name, tunnel URL), parsing the origin and token out of one paste. Profiles live in per-browser localStorage, so the token never reaches the daemon's registry file. A "connected to <device>" indicator in the header shows which daemon the dashboard is talking to.
