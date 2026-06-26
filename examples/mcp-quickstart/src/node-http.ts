import 'reflect-metadata'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  createMcpHttpHandler, oauth2McpMiddleware,
  type OAuth2Request, type OAuth2Response,
} from '@gemstack/mcp'
import { makeServer, verifyToken, REQUIRED_SCOPES } from './server.js'

const MCP_PATH = '/mcp'

// The OAuth middleware is Connect-shaped (req, res, next) with an Express-like
// `res`. node:http's ServerResponse isn't Express-shaped, so adapt it. This tiny
// adapter is the only glue needed to protect a raw node:http server.
function asOAuth2Res(res: ServerResponse): OAuth2Response {
  const extra: Record<string, string> = {}
  return {
    header(key, value) { extra[key] = value },
    status(code) {
      return {
        json(data: unknown) {
          res.writeHead(code, { 'content-type': 'application/json', ...extra })
          res.end(JSON.stringify(data))
        },
      }
    },
  }
}

// A plain (req, res) handler: OAuth first, then the MCP transport. Mounts on
// node:http directly; the same shape works on Express/Connect.
export function createNodeHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  const mcp = createMcpHttpHandler(makeServer())
  const auth = oauth2McpMiddleware(MCP_PATH, {
    scopes: REQUIRED_SCOPES,
    scopesSupported: ['mcp.read', 'mcp.write'],
    verifyToken,
  })
  return (req, res) => {
    void auth(req as unknown as OAuth2Request, asOAuth2Res(res), () => { void mcp(req, res) })
  }
}

// Runnable entry: `npx tsx src/node-http.ts` (or run the compiled file).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000)
  createServer(createNodeHandler()).listen(port, () => {
    console.log(`MCP server on http://localhost:${port}${MCP_PATH} (Bearer token required)`)
  })
}
