# Preview: stream the agent's headless browser so a human can step in when it's blocked

> Captured from team discussion. This is a preview / human-in-the-loop capability, not a toggleable "feature" and not about running Claude Code itself in a headless browser.

## Idea

The agent works in a headless browser. Stream its view (capture) to the client so a human can watch, and when the agent hits something it should not or cannot handle on its own, the human steps in by clicking on the streamed capture (x,y and keys relayed back to the headless browser), then the agent continues.

The point is not debugging or inspecting elements. The point is to see when the agent's browser is blocked and let a human resolve it.

## Why it matters

- See when the agent gets blocked (e.g. a bot check / reCAPTCHA, a login wall).
- Human-in-the-loop for sensitive steps: we do not autofill or save sensitive data (passwords, captcha). A reCAPTCHA means something important, so a human approves it manually through the streamed view rather than the agent handling it.

## Mechanism

- Capture + stream + input relay (x,y clicks, scroll, keys) over WebSocket. Reference implementation: the `stream-headless` script (https://github.com/suleimansh/stream-headless).
- Capture-and-stream is the approach that works. An `<iframe>` of the app was tried and did not work; opening the headless browser via "Share Screen" is not allowed. So capture + stream it is.
- Browser built in, headless, zero install, zero user configuration (not a Chrome extension). Something Electron-like could give this via a webview + MCP.

## Open questions

- Where it runs (most likely the daemon, #605).
- Is "preview" the right home for this, or its own capability alongside the agent's browser work?

## Related

- #452 (closed): gave the agent a real Chromium + chrome-devtools-mcp during runs.
- #469: bundle Chromium into the sandbox runner image.
- #605 (daemon): the likely host for the headless browser.

---
Source: https://github.com/gemstack-land/the-framework/issues/609
