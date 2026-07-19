---
'@gemstack/framework': minor
---

Tell the agent it has a browser. `--browser` wired the chrome-devtools tools into the run but the system channel never mentioned them, so the agent reached for `WebFetch` and the browser sat on `about:blank` for the whole run, taking the preview with it. Runs with a browser attached now get a short section saying it exists and that anything it needs to see or act on goes through those tools. Only when the tools are really there: the flag wires nothing on another agent or the fake driver.
