---
"@gemstack/the-framework": minor
---

Onboarding checklist and a settings page (#958).

The Overview gains an **Onboarding** section: add a project (one click for the directory the server runs in), fill the AI task queue, fill `tickets/` (with an "Import tickets from GitHub" button), add the Discord bot, turn on browser notifications, and add Discord notifications. Every step's done-state is derived from a real fact (a registered project, a non-empty queue, a ticket on disk, a granted browser permission, credentials the daemon holds), so a step cannot be ticked by clicking it, and one done outside the dashboard shows up done. It can be dismissed, which hides it only on the Overview.

Settings now have a page of their own at `/settings`, reachable from the header, collecting what was spread across the header menus: appearance and editor, agent / model / run-on, run options, eco, notifications, and automation. The Onboarding checklist lives there too and is not dismissible, which is what dismissing it on the Overview points you to.

Supporting changes: `onDashboard`'s per-project rollup carries `hasTickets`, a new `onOnboarding` read offers the server's working directory as a first project (gated on the same wiring as adding projects, so a public host discloses nothing), and `onboardingDismissed` joins the preferences.
