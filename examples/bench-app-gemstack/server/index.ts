import express from 'express'
import { createServer as createViteServer } from 'vite'
import { renderPage } from 'vike/server'
import { registerApi } from './api.js'

const PORT = Number(process.env.PORT ?? 3100)

async function start(): Promise<void> {
  const app = express()
  app.use(express.json())

  // HTTP contract (shared with bench-app-next) — registered before the Vike
  // catch-all so /api/* never falls through to page rendering.
  registerApi(app)

  // Vike + Vite dev middleware (SSR, HMR).
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  })
  app.use(vite.middlewares)

  // Catch-all: hand every non-API, non-asset request to Vike for SSR.
  app.use(async (req, res, next) => {
    const pageContext = await renderPage({ urlOriginal: req.originalUrl })
    const { httpResponse } = pageContext
    if (!httpResponse) return next()

    res.status(httpResponse.statusCode)
    for (const [name, value] of httpResponse.headers) res.setHeader(name, value)
    httpResponse.pipe(res)
  })

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[bench-app-gemstack] listening on http://localhost:${PORT}`)
  })
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
