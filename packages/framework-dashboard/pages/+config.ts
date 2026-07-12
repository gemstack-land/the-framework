import vikeReact from 'vike-react/config'
import type { Config } from 'vike/types'
import Layout from '../layouts/LayoutDefault.js'

// Global Vike config. SPA / client-only (ssr:false) per #405 — the dashboard is a
// projection of local files behind localhost, not an SSR app; keeping it a static
// bundle keeps it self-contained and relay-shareable. vike-react wires React.
export default {
  extends: vikeReact,
  Layout,
  ssr: false,
  title: 'The Framework',
} satisfies Config
