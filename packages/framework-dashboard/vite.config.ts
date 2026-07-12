import react from '@vitejs/plugin-react'
import vike from 'vike/plugin'
import { telefunc } from 'telefunc/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { eventsSse } from './server/events-sse.js'

// Spike (#406): Vike (SPA / client-only, see pages/+config.ts) + React + Tailwind v4
// + shadcn, with Telefunc for RPC (the Projects sidebar) and an SSE dev endpoint for
// the live event stream. Side-by-side with the MVP page.ts dashboard; nothing there
// is touched. Production serving (daemon serves the built bundle) is phase 2 (#405).
export default defineConfig({
  plugins: [react(), vike(), telefunc(), tailwindcss(), eventsSse()],
  server: {
    port: 4300,
  },
})
