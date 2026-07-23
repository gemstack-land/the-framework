import { cp, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Copy the prerendered dashboard bundle (#405) into the framework package so a published
// install can serve it (the daemon serves `dist/dashboard-client/**` as static files;
// the workspace dev fallback serves the dashboard's own dist/client). framework-dashboard
// is private/unpublished, so the assets must ride along inside @gemstack/the-framework's dist.
// Run after `@gemstack/framework-dashboard build` (which prerenders index.html).

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..', 'framework-dashboard', 'dist', 'client')
const dest = join(here, '..', 'dist', 'dashboard-client')

const hasIndex = await stat(join(src, 'index.html')).then(s => s.isFile()).catch(() => false)
if (!hasIndex) {
  // Skip rather than fail so a standalone `npm pack` of framework never breaks; a
  // release runs `framework-dashboard build` first (see the root `release` script), and
  // an install without the bundle just falls back to the legacy page.ts dashboard.
  console.warn(`[bundle:dashboard] no prerendered bundle at ${src}; skipping (dashboard falls back to page.ts)`)
  process.exit(0)
}

await rm(dest, { recursive: true, force: true })
await cp(src, dest, { recursive: true })
console.log(`[bundle:dashboard] copied ${src} -> ${dest}`)
