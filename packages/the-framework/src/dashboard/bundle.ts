import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Locate the prerendered dashboard bundle (#405): the published package ships it at
 * `dist/dashboard-client` (see scripts/bundle-dashboard.mjs); the workspace falls back
 * to `packages/framework-dashboard/dist/client`. Returns the directory only when its
 * `index.html` exists, else undefined (the caller then serves the legacy page.ts).
 * Shared by the daemon and the per-run foreground dashboard (#427).
 */
export async function resolveDashboardBundle(): Promise<string | undefined> {
  const here = dirname(fileURLToPath(import.meta.url)) // dist/dashboard (or src/dashboard) at runtime
  const candidates = [
    join(here, '..', 'dashboard-client'),
    join(here, '..', '..', '..', 'framework-dashboard', 'dist', 'client'),
  ]
  for (const dir of candidates) {
    if (await stat(join(dir, 'index.html')).then(s => s.isFile()).catch(() => false)) return dir
  }
  return undefined
}
