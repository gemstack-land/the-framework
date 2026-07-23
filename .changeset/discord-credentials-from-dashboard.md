---
"@gemstack/the-framework": minor
"@gemstack/framework-dashboard": minor
---

Configure the Discord bot and webhook from the dashboard (#1095).

Both Discord credentials were daemon environment variables and nothing else, so enabling Discord meant editing the daemon's environment and restarting it. That made it the one onboarding step you could not finish in the product: the #958 checklist could tell you the daemon had no token, and then only tell you to go elsewhere.

The setup dialogs now take the credential. It is stored in the registry file at the same tier as the daemon token (#1051): top level, never in `preferences`, so it cannot reach the browser bundle or a per-project override. The file is written owner-only. The daemon rebuilds its Discord services on the save, so the bot connects and the notification watchers start without a restart.

The value only ever moves inward. There is no read that returns a credential: the dashboard is told which ones exist and where each came from, which is the presence-only contract `onNotifyChannels` has had since #948. A stored credential shows as saved, with Replace and Remove rather than a field holding a secret.

An environment variable still wins over a stored value, and the dialog says so instead of offering an edit the daemon would shadow. That is how a container, a systemd unit or a shared box keeps configuring the daemon it runs.

The bell, the settings rows and the checklist now read this from one shared value rather than three independent polls, so saving a credential in one place settles all of them at once.
