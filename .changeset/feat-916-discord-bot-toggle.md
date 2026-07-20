---
'@gemstack/framework-dashboard': minor
---

A toggle for the Discord chatbot (#916)

The Discord chatbot (#680) is gated on a `discordBot` preference that had no UI, so turning it on
meant hand-editing `~/.the-framework.json`. It now sits in the notifications popover.

It gets its own "Chat" group rather than joining the delivery methods. Everything else in that menu
posts outward; this one takes messages in and lets them start and steer sessions, which is worth
keeping visually apart. For the same reason it stays off by default and does not light the bell,
which is about notifications.
