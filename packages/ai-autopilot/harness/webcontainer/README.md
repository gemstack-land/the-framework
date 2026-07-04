# WebContainer boot-and-serve harness

`WebContainerRunner` wraps [`@webcontainer/api`](https://webcontainers.io), which
runs **only inside a cross-origin-isolated browser** — it cannot boot in plain
Node. So, unlike `DockerRunner` (verified by a normal `node --test` suite against
a local daemon), the WebContainer adapter is proven by driving a **real headless
Chromium** against the compiled adapter. This directory is that proof.

## What it does

1. `server.mjs` serves a tiny page over `127.0.0.1` with the cross-origin
   isolation headers WebContainer needs (`COOP: same-origin`, `COEP:
   require-corp`), plus the compiled adapter (`/dist`) and `@webcontainer/api`
   (`/api`) same-origin.
2. `index.html` imports the **real** `dist/runner/webcontainer.js` and drives it
   exactly as an app would: boot, fs round-trip, `exec` (exit codes, cwd/env,
   timeout kill), `start` a server, resolve its `preview()` URL, prove it serves
   by fetching it from inside the container, then `dispose` and reboot.
3. `drive.mjs` launches headless Chromium (via `playwright-core`), loads the
   page, and asserts every check passed.

## Run it

```bash
pnpm build                          # compile the adapter into dist/
node harness/webcontainer/drive.mjs # headless boot-and-serve proof; exits non-zero on any failed check

HEADED=1 node harness/webcontainer/drive.mjs # opens a real Chrome window, runs the checks,
                                             # and renders the live app served by the WebContainer;
                                             # stays open until Ctrl-C
```

Requirements:

- **A Chromium browser.** Uses your system Google Chrome by default; falls back
  to a Playwright Chromium (`npx playwright install chromium`).
- **Network.** WebContainer downloads its runtime from StackBlitz on first boot,
  so this is not offline-hermetic (another reason it is opt-in, not part of
  `pnpm test`).

The Node-only guards (`webContainerAvailable()` is false outside a browser,
`boot()` throws a clear error in Node) are covered by `src/runner/webcontainer.test.ts`
and do run in the default suite.
