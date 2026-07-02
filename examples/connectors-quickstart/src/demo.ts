// Runnable: `pnpm --filter @gemstack/example-connectors-quickstart start`
// Mounts the reference connector and drives it through McpTestClient (no server
// or transport needed to see it working).
import 'reflect-metadata'
import { mountConnectors } from '@gemstack/mcp-connectors'
import { McpTestClient } from '@gemstack/mcp/testing'
import library from './library-connector.js'

const Server = mountConnectors([library], {
  name: 'connectors-quickstart',
  // A real orchestrator would resolve a real token per connector here.
  credentials: (id) => ({ token: process.env[`${id.toUpperCase()}_TOKEN`] }),
})

const client = new McpTestClient(Server)

const tools = await client.listTools()
console.log(
  'tools:',
  tools.map((t) => t.name),
)

const search = await client.callTool('library_search-books', { query: 'design' })
console.log('search "design":', text(search))

const book = await client.callTool('library_get-book', { id: 'b1' })
console.log('get b1:', text(book))

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0]
  return first && first.type === 'text' ? (first.text ?? '') : JSON.stringify(result.content)
}
