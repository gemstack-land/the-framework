---
'@gemstack/framework': minor
---

Dashboard control channel: the persistent daemon dashboard can now steer any run in its workspace. Its Stop button and choice picks append to `.framework/control.jsonl`; the run tails the file and aborts or resolves its parked gate. Gates now pause whenever a workspace daemon is live, not only when the run owns its own dashboard; headless behavior without a daemon is unchanged. Also fixes the fresh-workspace daemon startup: bare `framework` in a project with no `.framework/` yet used to fail and leave a zombie server on the port.
