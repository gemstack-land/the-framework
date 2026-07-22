---
'@gemstack/framework': minor
---

feat(framework): remote-daemon lane, non-loopback bind guarded by a shared token (#1051)

`framework --daemon --host <addr>` binds the dashboard daemon to a non-loopback address so a device you own can reach it. Because a daemon that spawns processes is code execution for anyone who finds the port, a non-loopback bind generates and persists a shared token (`crypto.randomBytes(32)`, a top-level `Registry.daemonToken`, never a preference and never shipped to the browser bundle), and one guard fronts every route (static bundle, `/_telefunc`, `/browser`): a request needs a valid `fw_daemon` cookie or a matching `?token=`, else 401, compared with `crypto.timingSafeEqual`. A valid `?token=` sets an `HttpOnly; SameSite=Strict` cookie and 302s to the clean path, so one cookie rides the RPC, the live-events Channel, and the MJPEG screencast alike. A loopback bind generates nothing and the guard is a no-op, so the local zero-config path is byte-identical. The CLI prints a loud warning and the token URL on any non-loopback bind. Composes with (does not replace) the existing CSRF origin check.
