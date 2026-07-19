---
'@gemstack/framework-dashboard': minor
'@gemstack/framework': minor
---

Show the run's browser in the run view. The stream shipped in #802 but nothing rendered it, and its URL only ever went to stdout, which a dashboard-started run discards. The run now publishes the port on its event log, the daemon proxies the stream and the input POST so the pane is same-origin, and the right rail gains a Browser tab that renders the frames and relays clicks and keys back to the page.
