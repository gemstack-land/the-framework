---
'@gemstack/framework': minor
---

Dashboard UX sweep (#948): every UI flow reviewed and the low scorers fixed. A lost live stream and a dead daemon now announce themselves (with automatic recovery), a session that crashed or was stopped no longer reads "finished", the replay opens at the outcome, choice gates and chat sends show sending/queued/error states instead of failing silently, presets get a visible menu with one management home, deleted @/# chips release their context focus, agent views render tables and links, the prompt preview includes the repo SYSTEM.md (#872), the browser panel recovers from a transient stream error (#946), the in-session gear stops offering spawn-time options as session state (#833), Discord toggles say when the daemon cannot deliver, and a broad accessibility pass (labels, roles, focus management) across menus, dialogs and icon buttons.
