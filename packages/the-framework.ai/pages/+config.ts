import vikeReact from 'vike-react/config'
import type { Config } from 'vike/types'

// Landing page for the-framework.ai. SSR + `prerender` emit fully static HTML into
// dist/client/, which the website-deploy.yml workflow pushes to GitHub Pages —
// no server at runtime. vike-react wires React.
export default {
  extends: vikeReact,
  prerender: true,
  title: 'The Framework — Autonomous AI',
  description:
    'Make the important decisions, let AI do the rest. The Framework turns AI agents into autonomous teammates that handle work end-to-end — while you stay in control of key decisions.',
  favicon: '/assets/logo.svg',
} satisfies Config
