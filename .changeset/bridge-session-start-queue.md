---
'@gemstack/the-framework': minor
---

The browser bridge gains a session start-queue: the daemon can queue a repo, branch and prompt for the extension to create a session from, and the extension reports back the session it became. Two new routes, `GET /_bridge/start` (claims the next request as it serves it, so two polling tabs cannot create two sessions for one request) and `POST /_bridge/started`. The queue lives daemon-side with a claim that ages out, so a browser that quits mid-creation retries rather than bricking the request. The bridge's input surface is unchanged: the daemon is the producer of a start request and the extension only ever posts back an id, a boolean and a session id.
