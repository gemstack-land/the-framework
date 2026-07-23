---
"@gemstack/the-framework": minor
---

Manage saved devices from the settings page.

Adding and removing a device already worked, but only from the composer's "Run on" menu, and the composer only exists on a project launcher. From the Overview or the settings page there was no way to manage the roster at all. The settings page now has a **Devices** section listing each saved device with its origin and online/offline status, an Add device button, and a remove per row. The "Run on" picker still lists devices, because choosing a run target is a per-run act; which devices exist is configuration.

Removing a device from settings clears the run target when that device was the one selected, the same guard the composer already applied, so a run can never point at a device that is no longer saved.

The section states that devices are saved in the browser rather than on the server: unlike every other setting on the page, a device carries a token, so it stays in this browser's storage and never reaches the daemon.
