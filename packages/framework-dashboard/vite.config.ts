import react from '@vitejs/plugin-react'
import vike from 'vike/plugin'
import { telefunc } from 'telefunc/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Dashboard (#405): Vike (SPA / client-only, see pages/+config.ts) + React + Tailwind
// v4 + shadcn, with Telefunc for everything over the wire — the read-model RPCs plus
// the live event stream, which is a Telefunc Channel (server/events.telefunc.ts), not
// a custom endpoint anymore. Side-by-side with the MVP page.ts dashboard; nothing
// there is touched. Production serving (daemon serves the built bundle) is next (#405).
export default defineConfig({
  plugins: [react(), vike(), telefunc(), tailwindcss()],
  server: {
    port: 4300,
  },
})
