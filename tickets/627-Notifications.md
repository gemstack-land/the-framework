# Notifications

When human intervention is required (e.g. task is done and ready to merge, or AI is waiting for user answer), fire a browser notification (and/or a Discord message).

Settings:
- Notifications
  - [ ] Human intervention (default: true)
  - [ ] New activity (default: false)
- Notification methods
  - [ ] Browser (default: true)
  - [ ] Discord (default: false, requires DISCORD_WEBWOOK)

> [!NOTE]
> The Discord integration is simple: the only secret is just a Discord webhook the user can get via the Discord UI.
> - https://github.com/vikejs/vike/blob/15c05abaeae57bc3112702a8faeca36c20ee13ea/.github/workflows/discord-notification.yml
> <img width="937" height="131" alt="Image" src="https://github.com/user-attachments/assets/2653c6cd-034d-4ade-96ee-abf929bde1c5" />

For me, that would be a feature enough to start using The Framework.

If it's a quick-win (I think it is), then I'd say let's do it now.

---
Source: https://github.com/gemstack-land/gemstack/issues/627
