# bench-app-next

Vanilla **Next.js (App Router)** baseline for the GemStack AI benchmark. It implements the
shared Notes product + HTTP contract from `benchmarks/spec/product.md` with **no GemStack
packages and no AI orchestration layer** - this is the strawman-free control the GemStack
app is measured against.

- Storage: `better-sqlite3`, one file at `data/notes.db` (git-ignored), seeded on first boot
  with user `demo@example.com` / `password`.
- AI summarize: a deterministic, network-free inline stub (`lib/summarize.ts`) that returns
  the first sentence of the body trimmed to <= 140 chars. No SDK, no API key.

## Run

```bash
# from the gemstack repo root (links the workspace package)
pnpm install

cd examples/bench-app-next
pnpm dev
```

Dev server: **http://localhost:4311** (fixed port, via `next dev -p 4311`).

Open `/` (redirects to `/login` until you sign in).

### One-time workspace note

Next pulls `sharp` (its optional image optimizer), which ships prebuilt binaries but still
carries an unapproved build script. In a pnpm 11 workspace that makes `pnpm install` exit
non-zero with an "ignored builds" nag, and pnpm's pre-run deps check re-runs install before
`pnpm dev` - so a bare `pnpm dev` can abort. Two equivalent fixes:

- **Approve it once (recommended):** add `sharp` to `onlyBuiltDependencies` in the repo-root
  `pnpm-workspace.yaml` (next to `esbuild` / `better-sqlite3`), or run `pnpm approve-builds`
  and select `sharp`. After that, bare `pnpm dev` just works.
- **Skip the check per-run (no root change):**
  ```bash
  pnpm_config_verify_deps_before_run=false pnpm dev
  ```

## HTTP contract

All endpoints return JSON. `/api/login` sets a `session` cookie; the protected endpoints
require it and return `401` without it.

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/login` | `{ email, password }` | `200 { ok: true }` + `session` cookie (`401` on bad creds) |
| POST | `/api/logout` | - | `200 { ok: true }` (clears cookie) |
| GET | `/api/notes` | - | `200 { notes: Note[] }` (newest first) |
| POST | `/api/notes` | `{ title, body }` | `201 { note: Note }` |
| GET | `/api/notes/:id` | - | `200 { note: Note }` (`404` if absent) |
| DELETE | `/api/notes/:id` | - | `200 { ok: true }` |
| POST | `/api/notes/:id/summarize` | - | `200 { note: Note }` (sets `summary`) |

`Note` = `{ id: number, title: string, body: string, summary: string | null, createdAt: string }`.

## Acceptance

```bash
BASE_URL=http://localhost:4311 node ../../benchmarks/tasks/task-001-tags/accept.mjs
```

> Note: the committed baseline does **not** implement tags - that is `task-001-tags`, which an
> agent adds on top of this starting point.
