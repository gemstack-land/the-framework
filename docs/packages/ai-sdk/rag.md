# Vector Stores & RAG

Retrieval-augmented generation (RAG) means giving an agent a search tool over a document corpus so it can ground its answers in your own content. `@gemstack/ai-sdk` supports two shapes:

- **Hosted vector stores** - the provider runs ingestion, chunking, embedding, and search server-side. You upload files, wire the store into an agent, and the model retrieves inline. No tool round-trip, no embedding code.
- **Bring-your-own embeddings + cosine search** - you embed text with `AI.embed(...)`, store the vectors in your own database, and the agent searches them through a tool you supply. More moving parts, full control, no provider lock-in.

This page also covers the supporting surface: embeddings, embedding caches, and reranking. Provider-specific behavior is kept light here; see [/packages/ai-sdk/providers](/packages/ai-sdk/providers) for which providers implement what.

Every example assumes a provider is registered:

```ts
import { AiRegistry, OpenAIProvider } from '@gemstack/ai-sdk'

AiRegistry.register(new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }))
AiRegistry.setDefault('openai/gpt-4o')
```

## Hosted vector stores

`VectorStores` is the façade for managing a provider-hosted store; `fileSearch({ stores })` is the agent tool that searches it. The provider runs ingestion, chunking, embedding, and search; the model invokes the native tool block (OpenAI's `file_search`) and the results land inline in the assistant reply.

```ts
import { Agent, VectorStores, fileSearch } from '@gemstack/ai-sdk'

// 1. Create a store and add files (ingest + embed happen provider-side)
const kb = await VectorStores.create('Knowledge Base')                    // OpenAI by default
await kb.add({ filePath: './report.pdf', attributes: { author: 'Alice', year: 2026 } })

// 2. Wire it into an agent
class SupportAgent extends Agent {
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores:     [kb.id],
        where:      { author: 'Alice', year: 2026 },   // server-side metadata filter
        maxResults: 10,
      }),
    ]
  }
}
```

### Managing stores (`VectorStores` / `VectorStore`)

`VectorStores` is the static façade; each call resolves to a `VectorStore` instance:

| Call | Returns | Notes |
|---|---|---|
| `VectorStores.create(name, opts?)` | `VectorStore` | `opts` accepts `metadata`, `expiresAfter`, `provider`. |
| `VectorStores.get(id, opts?)` | `VectorStore` | Re-hydrate an existing store by id. |
| `VectorStores.list(opts?)` | `VectorStore[]` | List stores for the provider. |
| `VectorStores.delete(id, opts?)` | `void` | Delete a store (its files are managed separately). |

On a `VectorStore` instance:

| Method | Purpose |
|---|---|
| `store.add(opts)` | Attach a file. Pass `fileId`, `filePath`, or `fileBuffer`, plus searchable `attributes` and an optional `chunkingStrategy`. By default waits for ingest + embed to finish (`wait: false` for fire-and-forget). |
| `store.files(opts?)` | List the files attached to the store. |
| `store.remove(fileId)` | Detach a file from the store (does not delete the underlying provider file). |
| `store.delete()` | Delete the store. |

`store.add(...)` detaching is store-level only; to fully delete the underlying provider file use the [File Manager](#file-management) (`AI.files(provider).delete(id)`).

### The `fileSearch` tool

`fileSearch({ stores, where?, maxResults?, name?, description? })` returns a first-class agent tool. On OpenAI the adapter recognizes the tool's provider hint and emits the native `file_search` block, so the search runs server-side and the model never makes a function-call round-trip.

Metadata filtering uses the `where` option. The sugar form `where: { author: 'Alice', year: 2026 }` is shorthand for the typed OpenAI filter `{ type: 'and', filters: [{ type: 'eq', key: 'author', value: 'Alice' }, { type: 'eq', key: 'year', value: 2026 }] }`. Pass the typed object form directly for `gt` / `lt` / `ne` / `or` operators. The exported `normalizeWhere(where)` performs that lowering and is reused by the adapter (and available to you for tests). `isFileSearchTool(tool)` is a type guard for detecting the tool in a tools array.

> Hosted file search is provider-specific. A provider that does not recognize the hint sees a plain function-call tool with a `{ query: string }` placeholder schema. To stay portable across hosted and self-hosted, pass a `fallback` (see below) so non-hosted providers run your own cosine search instead.

## Bring-your-own embeddings + cosine search

When you do not want a hosted store - to avoid lock-in, keep data on your own infrastructure, or use a local Postgres + pgvector corpus - embed text yourself and search it with a tool you supply.

### Generating embeddings (`AI.embed`)

`AI.embed(input, opts?)` returns an `EmbeddingResult` (`{ embeddings: number[][]; usage }`). Pass a string or an array of strings; arrays over 100 inputs are auto-batched:

```ts
import { AI } from '@gemstack/ai-sdk'

const { embeddings } = await AI.embed('Project Foo deploys to fly.io', {
  model: 'openai/text-embedding-3-small',
})
//=> embeddings: number[][] (one vector per input)
```

Pass `{ cache: true }` to memoize repeated inputs in-process (handy when re-embedding the same query). The provider must implement embeddings; calling `AI.embed` on a provider that does not throws with a clear message (OpenAI, Google, Mistral, Cohere, Voyage, Jina support it). The contract is the `EmbeddingAdapter` interface (`embed(input, model): Promise<EmbeddingResult>`), so you can wrap or substitute your own.

### Caching embeddings (`CachedEmbeddingAdapter`)

`CachedEmbeddingAdapter` wraps any `EmbeddingAdapter` and caches results by `model:text` key, so repeated inputs skip the provider call (cache hits report zero token usage). `AI.embed({ cache: true })` uses it internally; construct one directly when you manage the adapter yourself:

```ts
import { CachedEmbeddingAdapter } from '@gemstack/ai-sdk'

const cached = new CachedEmbeddingAdapter(innerEmbeddingAdapter)
```

### Searching your own vectors (`similaritySearch`)

`similaritySearch({ model, column, embedWith, ... })` is an agent-tool factory: the model emits a natural-language `query`, the tool embeds it with `AI.embed(...)`, runs a vector search over your data, and returns the top rows ranked by similarity.

It accepts any Model that satisfies the structural `SimilaritySearchModel` interface - the engine calls `model.query()` and the query-builder methods (`whereVectorSimilarTo`, `selectVectorDistance`, `where`, `limit`, `get`) but never imports an ORM package. You bring your own Model with a vector column:

```ts
import { Agent, similaritySearch } from '@gemstack/ai-sdk'
import { Document } from './app/Models/Document.js'   // your own Model, structural fit

class KnowledgeAgent extends Agent {
  tools() {
    return [
      similaritySearch({
        model:         Document,
        column:        'embedding',                   // vector column on the Model
        embedWith:     'openai/text-embedding-3-small',
        minSimilarity: 0.7,
        limit:         10,
      }),
    ]
  }
}
```

Each result is a `SimilarityHit` (`{ row, similarity }`); for the default `cosine` metric, `similarity` is `1 - distance`.

### Same prompt, hosted or self-hosted (`fallback`)

`fileSearch({ ..., fallback })` bridges the two worlds: on OpenAI the native `file_search` block runs server-side; on any other provider the tool gains an `execute` that delegates to a `similaritySearch` over your own Model. The agent prompt and tool name stay identical across providers - you change only the registered provider:

```ts
fileSearch({
  stores:   [kb.id],
  fallback: { model: Document, column: 'embedding', embedWith: 'openai/text-embedding-3-small' },
})
```

## Reranking

Reranking reorders an existing candidate list by relevance to a query - a cheap precision boost after a coarse first-stage retrieval (vector or keyword). `AI.rerank(query, documents, opts?)` returns a `RerankingResult` whose `results` are `{ index, relevanceScore, document }` sorted by relevance:

```ts
import { AI } from '@gemstack/ai-sdk'

const { results } = await AI.rerank('how do I reset my password?', candidateChunks, {
  model: 'cohere/rerank-v3.5',
  topK:  5,
})
// results[0] -> { index, relevanceScore, document } (most relevant first)
```

The fluent builder `Reranker.of(query, documents).model(...).topK(...).rank()` is the same surface if you prefer it. Reranking needs a provider that implements it (Cohere, Voyage, Jina); see [/packages/ai-sdk/providers](/packages/ai-sdk/providers).

A typical RAG pipeline chains these: `AI.embed` the query, `similaritySearch` (or `fileSearch`) to pull candidates, then `AI.rerank` to tighten the top-K before handing passages to the model.

## File management

`AI.files(provider?)` returns a `FileManager` for provider-side file storage - the files hosted stores ingest from, and any other provider file objects:

| Method | Purpose |
|---|---|
| `files.upload(filePath, opts?)` | Upload a file; `opts.purpose` (e.g. `'assistants'`). Returns `{ id, ... }`. |
| `files.list()` | List uploaded files. |
| `files.retrieve(fileId)` | Fetch file content (not all providers support this). |
| `files.delete(fileId)` | Delete a file. Use this to fully remove a file a vector store only detached. |

```ts
import { AI } from '@gemstack/ai-sdk'

const files = AI.files('openai')
const uploaded = await files.upload('./report.pdf', { purpose: 'assistants' })
await files.delete(uploaded.id)
```

## Provider support at a glance

Hosted file search, embeddings, and reranking are each provider-specific capabilities. Rather than duplicate the matrix here, see [/packages/ai-sdk/providers](/packages/ai-sdk/providers) for which providers implement embeddings, reranking, and hosted vector stores. The portable pattern is: keep the agent's `tools()` and prompt identical, and switch capability by changing the registered provider and model string.
