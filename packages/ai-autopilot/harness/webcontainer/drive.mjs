// Boot-and-serve proof for WebContainerRunner. WebContainer runs only in a
// cross-origin-isolated browser, so this drives a real headless Chromium against
// the compiled adapter and asserts it boots, execs, serves, and tears down.
//
// Prereqs: build the package (`pnpm build`) and have Google Chrome installed, or
// a Playwright Chromium (`npx playwright install chromium`). Then:
//   node harness/webcontainer/drive.mjs           # headless verification (exits 0/1)
//   HEADED=1 node harness/webcontainer/drive.mjs  # opens a real window + live preview, stays open
//
// Needs network: WebContainer downloads its runtime from StackBlitz on first boot.
import { chromium } from 'playwright-core'
import { startServer } from './server.mjs'

const headed = process.env.HEADED === '1'

async function launch() {
  // Prefer a system Chrome (no browser download); fall back to a Playwright Chromium.
  try {
    return await chromium.launch({ headless: !headed, channel: 'chrome' })
  } catch {
    try {
      return await chromium.launch({ headless: !headed })
    } catch (err) {
      console.error(
        'No usable Chromium. Install Google Chrome, or run `npx playwright install chromium`.\n' + err,
      )
      process.exit(2)
    }
  }
}

const { server, port } = await startServer()
const browser = await launch()
const page = await browser.newPage()
page.on('console', (m) => console.log('[page]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

let result
try {
  await page.goto(`http://127.0.0.1:${port}/${headed ? '?demo=1' : ''}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__RESULT__ && window.__RESULT__.done, { timeout: 90000 })
  result = await page.evaluate(() => window.__RESULT__)
} catch (e) {
  result = { done: false, ok: false, error: 'harness timeout: ' + e.message }
}

const passed = (result.checks ?? []).filter((c) => c.ok).length
const total = (result.checks ?? []).length
console.log(`\n${result.ok ? 'OK' : 'FAILED'} — ${passed}/${total} checks passed`)
if (result.error) console.log('error:', result.error)

if (headed) {
  // Leave the window (and the WebContainer's live preview) open to inspect.
  console.log('\nBrowser window is open with the live preview. Press Ctrl-C to exit.')
  await new Promise(() => {})
}

await browser.close()
server.close()
process.exit(result.ok ? 0 : 1)
