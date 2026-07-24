import http from 'node:http'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import vike from 'vike/plugin'
import { telefunc } from 'telefunc/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

// Opt-in (`pnpm dev:daemon`, i.e. FRAMEWORK_DEV_DAEMON=1): let the dev server actually start runs.
//
// `pnpm dev` alone is the Vite dev server with no Telefunc context, so `sendStart` reports "starting
// a session is not enabled on this server" (same gap that leaves preferences unpersisted in dev).
// Only the daemon has the `startRun` handler. This plugin brings up that daemon (the framework's own
// `ensureDaemon`, idempotent — it reuses one already running) and proxies `/_telefunc` (RPCs and the
// SSE Channel) to it, so the live-reload UI gets the full backend, run-starting included.
//
// The proxy middleware is registered synchronously so it lands ahead of Telefunc's own middleware;
// it holds requests until the daemon is up. Left out by default so the plain dev server stays a
// pure UI harness with no detached process spawned behind it. The daemon is detached and outlives
// the dev server (stop it with `the-framework stop`).
function frameworkDevDaemon(): Plugin {
  return {
    name: 'framework:dev-daemon',
    apply: 'serve',
    configureServer(server) {
      if (!process.env.FRAMEWORK_DEV_DAEMON) return
      let target: { hostname: string; port: string } | null = null
      const ready = (async () => {
        const [{ ensureDaemon }, { fileURLToPath }, path] = await Promise.all([
          import('@gemstack/the-framework'),
          import('node:url'),
          import('node:path'),
        ])
        // The daemon spawns a detached child of the framework CLI; without an explicit binPath it
        // would re-invoke `process.argv[1]`, which here is vite, not the framework. Point it at the
        // framework's own bin (dist/bin.js, beside its resolved dist/index.js). The package is
        // ESM-only (no CJS main), so resolve via the ESM resolver rather than require.resolve.
        const binPath = path.join(path.dirname(fileURLToPath(import.meta.resolve('@gemstack/the-framework'))), 'bin.js')
        const cwd = process.env.FRAMEWORK_DEV_DAEMON_CWD || process.cwd()
        const { state, alreadyRunning } = await ensureDaemon(cwd, { binPath })
        const url = new URL(state.url)
        target = { hostname: url.hostname, port: url.port || '4200' }
        server.config.logger.info(
          `\n[framework] dev daemon ${alreadyRunning ? 'reused' : 'started'} at ${state.url} — starting runs is enabled\n`,
        )
      })().catch((err: unknown) => {
        server.config.logger.error(
          `[framework] dev daemon did not start (${err instanceof Error ? err.message : String(err)}); ` +
            `reads still work, but starting a run stays disabled`,
        )
      })

      // Registered up front (not after the await) so it sits ahead of Telefunc's middleware; the
      // request waits on `ready` when it arrives before the daemon has come up.
      server.middlewares.use((req, res, next) => {
        const url = req.originalUrl ?? req.url ?? ''
        if (!url.startsWith('/_telefunc')) return next()
        const forward = (dest: { hostname: string; port: string }): void => {
          // Host header left as the browser sent it (localhost:<devport>), so the daemon's same-origin
          // guard passes; the SSE Channel just rides the piped response.
          const proxyReq = http.request(
            { hostname: dest.hostname, port: dest.port, method: req.method, path: url, headers: req.headers },
            proxyRes => {
              res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
              proxyRes.pipe(res)
            },
          )
          proxyReq.on('error', () => {
            if (!res.headersSent) {
              res.statusCode = 502
              res.end('framework dev daemon proxy error')
            }
          })
          req.pipe(proxyReq)
        }
        if (target) return forward(target)
        // Daemon still coming up, or it failed: once `ready` settles, proxy if it is up, otherwise
        // fall through to Vite's own telefunc handling so reads keep working (sendStart just reports
        // it is not enabled there) instead of erroring every request.
        void ready.then(() => (target ? forward(target) : next()))
      })
    },
  }
}

// `pnpm dev` only. Telefunc's client marks every request URL with its kind
// (`/_telefunc?_telefunc=txt`, `sse` for a Channel) and may append an advisory `session`, but its
// dev middleware matches with `url !== '/_telefunc'`, so it declines its own requests. Vike's
// catch-all route (#784) then answers them with the SPA shell, and since Vike's dev middleware
// never calls next() on a 404, every read failed on `Unexpected token '<'` and the UI sat behind
// the daemon-down banner. Dropping the query restores the exact match: the request kind and the
// session both ride headers too, and Telefunc's own docs call the URL param advisory. Registered
// from configureServer directly so it lands ahead of the middlewares Vike and Telefunc add from
// their returned post-hooks. The daemon is unaffected: it matches on the parsed pathname.
function telefuncDevUrlFix(): Plugin {
  return {
    name: 'framework:telefunc-dev-url-fix',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.originalUrl ?? req.url
        if (url?.startsWith('/_telefunc?')) {
          req.url = '/_telefunc'
          req.originalUrl = '/_telefunc'
        }
        next()
      })
    },
  }
}

// Dashboard (#405): Vike (SPA / client-only, see pages/+config.ts) + React + Tailwind
// v4 + shadcn, with Telefunc for everything over the wire — the read-model RPCs plus
// the live event stream, which is a Telefunc Channel (server/events.telefunc.ts), not
// a custom endpoint anymore. Side-by-side with the MVP page.ts dashboard; nothing
// there is touched. Production serving (daemon serves the built bundle) is next (#405).
export default defineConfig({
  plugins: [frameworkDevDaemon(), telefuncDevUrlFix(), react(), vike(), telefunc(), tailwindcss()],
  // `@/*` -> package root, matching tsconfig `paths` (used by the copied-in animate-ui components).
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  server: {
    port: 4300,
  },
  // TO-DO/eventually: remove this workaround once upstream fixed the issue
  // Temporary workaround for Vike error
  // https://github.com/gemstack-land/the-framework/issues/460
  vitePluginServerEntry: { disableAutoImport: true },
} as UserConfig)
