import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import vike from 'vike/plugin'
import { telefunc } from 'telefunc/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

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
  plugins: [telefuncDevUrlFix(), react(), vike(), telefunc(), tailwindcss()],
  // `@/*` -> package root, matching tsconfig `paths` (used by the copied-in animate-ui components).
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  server: {
    port: 4300,
  },
  // TO-DO/eventually: remove this workaround once upstream fixed the issue
  // Temporary workaround for Vike error
  // https://github.com/gemstack-land/gemstack/issues/460
  vitePluginServerEntry: { disableAutoImport: true },
} as UserConfig)
