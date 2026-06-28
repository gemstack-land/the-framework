# bench-app-gemstack

The **GemStack** side of the AI benchmark (see `benchmarks/`). A minimal but real
**Vike + React (SSR)** Notes app whose **AI summarize** feature is wired through
[`@gemstack/ai-sdk`](../../packages/ai-sdk) — the orchestration layer "in reach".

Its twin, `bench-app-next`, implements the **same product and the same HTTP
contract** (`benchmarks/spec/product.md`) with a vanilla inline provider call, so
one acceptance script runs against either by pointing `BASE_URL` at the server.

> Baseline scope: notes have `id`, `title`, `body`, `summary`, `createdAt` only.
> Tags are a later agent task and are intentionally **not** implemented here.

## Run

From the repo root, build the SDK once, then start the app:

```bash
pnpm --filter @gemstack/ai-sdk build      # the app imports the SDK's dist
cd examples/bench-app-gemstack
pnpm dev                                   # http://localhost:3100
```

Fixed port **3100** (override with `PORT`). It differs from the Next.js sibling's
3000 so both can run at once. The server is Express in Vite middleware mode: it
serves `/api/*` directly and hands every other route to Vike for React SSR.

Seed user: `demo@example.com` / `password` (seeded into SQLite on first boot).

## HTTP contract

JSON everywhere. Auth endpoints set/clear a `session` cookie; protected
endpoints require it and return `401` without it.

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/login` | `{ email, password }` | `200 { ok: true }` + cookie (`401` on bad creds) |
| POST | `/api/logout` | – | `200 { ok: true }` |
| GET | `/api/notes` | – | `200 { notes: Note[] }` (newest first) |
| POST | `/api/notes` | `{ title, body }` | `201 { note: Note }` |
| GET | `/api/notes/:id` | – | `200 { note: Note }` (`404` if absent) |
| DELETE | `/api/notes/:id` | – | `200 { ok: true }` |
| POST | `/api/notes/:id/summarize` | – | `200 { note: Note }` (sets `summary`) |

`Note` = `{ id: number, title: string, body: string, summary: string | null, createdAt: string }`.

## How summarize uses `@gemstack/ai-sdk`

`server/ai.ts` registers a **deterministic stub provider** on the SDK's provider
seam (`AiRegistry.register` with a `ProviderFactory` / `ProviderAdapter`) and sets
it as the default model. `summarize()` then calls the SDK facade, `AI.prompt(body,
{ model: 'stub/summarize-v1' })` — so the path runs through the GemStack agent
loop, not a direct model call. The stub computes the result from the prompt it
receives (first sentence of the body, trimmed to ≤ 140 chars): no network, no API
key, fully reproducible. Swapping in a real provider later is a one-line change to
the model string.

## Storage

`better-sqlite3`, one file at `data/bench.sqlite` (git-ignored), created and
seeded on first boot. Schema matches the spec (`users`, `notes`).

## Layout

```
server/
  index.ts   Express + Vite-middleware dev server (API + Vike SSR catch-all)
  api.ts     the HTTP contract (session-cookie auth)
  db.ts      better-sqlite3 schema, seed, queries
  ai.ts      @gemstack/ai-sdk stub provider + summarize()
pages/
  +config.ts        vike-react config
  index/+Page.tsx   notes list (create form, per-note delete + summarize)
  login/+Page.tsx   sign-in
  note/@id/+Page.tsx note detail
  api.ts            client-side fetch wrapper over the contract
```
