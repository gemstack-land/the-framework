// A reference connector. Copy this file to start a real one: swap the in-memory
// data for calls to your external service, and change `auth` to `pat` / `oauth`.
import { defineConnector } from '@gemstack/mcp-connectors'
import { z } from 'zod'

interface Book {
  id: string
  title: string
  author: string
}

// Stand-in for an external service. A real connector calls an API here, using
// `ctx.auth.token` (see the `handle` signatures below).
const BOOKS: Book[] = [
  { id: 'b1', title: 'The Pragmatic Programmer', author: 'Hunt & Thomas' },
  { id: 'b2', title: 'Refactoring', author: 'Fowler' },
  { id: 'b3', title: 'Domain-Driven Design', author: 'Evans' },
]

export default defineConnector({
  id: 'library',
  name: 'Reference Library',
  instructions: 'A read-only demo connector over a small in-memory book list.',
  // This demo needs no credential. A real connector declares `pat` or `oauth`;
  // the orchestrator then resolves a token and hands it via `ctx.auth`.
  auth: { type: 'none' },
  tools: [
    {
      name: 'list-books',
      description: 'List every book in the library.',
      schema: z.object({}),
      annotations: { readOnly: true, openWorld: true },
      handle: () => BOOKS,
    },
    {
      name: 'search-books',
      description: 'Search books by a case-insensitive substring of the title.',
      schema: z.object({ query: z.string().min(1) }),
      annotations: { readOnly: true, openWorld: true },
      handle: (input: { query: string }) => {
        const q = input.query.toLowerCase()
        return BOOKS.filter((b) => b.title.toLowerCase().includes(q))
      },
    },
    {
      name: 'get-book',
      description: 'Fetch one book by id.',
      schema: z.object({ id: z.string() }),
      annotations: { readOnly: true, openWorld: true },
      handle: (input: { id: string }) => {
        const book = BOOKS.find((b) => b.id === input.id)
        return book ?? { error: `no book with id ${input.id}` }
      },
    },
  ],
})
