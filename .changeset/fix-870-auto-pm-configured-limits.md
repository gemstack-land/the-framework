---
"@gemstack/framework": patch
---

Auto PM now paces itself by your own usage limits (#870). It used to keep a second budget rule of its own, refusing unless half of every window was still free, so there were two sets of limits to reason about and the stricter one was invisible. It now runs while your configured limits are not met and stands down once one is, which is the same line autopilot already stops at.

It still refuses to start anything when the quota cannot be read at all: an unreadable budget must never stop your own work, but it does stop work nobody asked for.

The `DEFAULT_MIN_FREE_PERCENT` export and the `minFreePercent` override are gone with the rule.
