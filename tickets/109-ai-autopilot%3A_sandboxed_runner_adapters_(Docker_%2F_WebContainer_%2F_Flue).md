# ai-autopilot: sandboxed runner adapters (Docker / WebContainer / Flue)

Follow-up from the ai-autopilot epic (#97). The runner seam and the first real adapter (`LocalRunner`, #106) shipped. What's left are the *sandboxed* adapters that isolate untrusted agent code:

- [x] **Docker** — full-fidelity, background/long-running; needs a Docker daemon. **Shipped** (`DockerRunner`, PR #142; sandboxed boot-and-serve E2E, PR #143).
- [x] **WebContainer** — instant in-browser Vike preview; needs a browser runtime. **Shipped** (`WebContainerRunner`, PR #223; headless-Chromium boot-and-serve harness under `harness/webcontainer/`, 15/15).
- [ ] **Flue** — mirror Flue's `sandbox` contract (in-memory / edge / container); needs a live Flue env.

`LocalRunner` is the reference each mirrors; `FakeRunner` covers tests. Docker is done; WebContainer and Flue remain infra-gated (can't be built and honestly verified without provisioning that infra first).

---
Source: https://github.com/gemstack-land/the-framework/issues/109
