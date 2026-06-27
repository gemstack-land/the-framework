# Structured Output & Attachments

Two ways to push past plain text: get a typed object back from a run, and send images or documents in.

## Structured output

`Output` builds an `OutputWrapper<T>`: a small helper that knows how to (1) instruct the model to emit JSON matching a [Zod](https://zod.dev) schema and (2) parse the model's text back into a validated, typed value. It is a standalone helper, so the flow is explicit: add `output.toSystemPrompt()` to the agent's instructions, then call `output.parse(response.text)` on the result.

```ts
import { agent, Output } from '@gemstack/ai-sdk'
import { z } from 'zod'

const output = Output.object({
  schema: z.object({
    sentiment: z.enum(['positive', 'neutral', 'negative']),
    score:     z.number().min(0).max(1),
  }),
})

const response = await agent({
  instructions: `Classify the sentiment of the user's message.\n\n${output.toSystemPrompt()}`,
}).prompt('I absolutely love this product!')

const parsed = output.parse(response.text)
//    ^? { sentiment: 'positive' | 'neutral' | 'negative'; score: number }
```

`parse(text)` strips an optional ``` ```json ``` markdown fence before parsing, then validates against the Zod schema, so Zod transforms, defaults, and coercion all apply. It throws if the text is not valid JSON or fails schema validation; let that surface (or wrap it) so a malformed model reply is caught rather than silently mistyped.

### Three output shapes

| Builder | Returns | Use for |
|---|---|---|
| `Output.object({ schema })` | the object `z.infer<typeof schema>` | one structured record |
| `Output.array({ element })` | `z.infer<element>[]` | a list of records |
| `Output.choice({ options })` | one of the literal options | classification into a fixed set |

```ts
// A list of records
const items = Output.array({ element: z.object({ id: z.number(), title: z.string() }) })

// Single-label classification (no JSON: the model replies with one option)
const label = Output.choice({ options: ['bug', 'feature', 'question'] as const })
const which = label.parse(response.text)   // 'bug' | 'feature' | 'question'
```

Every wrapper exposes `type` (`'object'` / `'array'` / `'choice'`), the underlying Zod `schema`, `parse(text)`, and `toSystemPrompt()`. `Output.choice` parses the trimmed text directly against a `z.enum`, so its `toSystemPrompt()` asks the model for exactly one option and nothing else.

## Multi-modal attachments

Send images and documents alongside a prompt with the `Image` and `Document` classes (exported aliases of `ImageAttachment` and `DocumentAttachment`). Build an attachment, call `.toAttachment()`, and pass the result on the prompt's `attachments` array:

```ts
import { agent, Image } from '@gemstack/ai-sdk'

const img = Image.fromBase64(cameraBase64, 'image/jpeg')

const response = await agent('You describe images.')
  .prompt('What is in this photo?', { attachments: [img.toAttachment()] })
```

### Factories

`Image` and `Document` both build from base64 or a URL; `Document` adds a raw-string factory. The URL factories are async (they fetch the bytes and infer the MIME type from the response).

```ts
import { Image, Document } from '@gemstack/ai-sdk'

// Image
const fromB64 = Image.fromBase64(base64, 'image/png')
const fromUrl = await Image.fromUrl('https://example.com/photo.jpg')

// Document
const fromText = Document.fromString('Quarterly numbers...', 'q3.txt')   // text/plain
const docB64   = Document.fromBase64(pdfBase64, 'application/pdf', 'report.pdf')
const docUrl   = await Document.fromUrl('https://example.com/report.pdf')
```

Each instance offers `.toAttachment()` (for the `attachments` option) and `.toContentPart()` (a `ContentPart` for hand-building a multi-part message). The helpers `attachmentsToContentParts(attachments)` and `getMessageText(content)` are exported for assembling and reading multi-part message content.

Calling LLM providers directly from a browser or React Native client leaks your API key, so prefer the byte and URL factories on the client and a server-side proxy in production. The main client-side use case is bring-your-own-key desktop apps.

### Node path helpers

In a Node runtime, load attachments straight from the filesystem with `@gemstack/ai-sdk/node`. `imageFromPath(path)` and `documentFromPath(path)` read the file, base64-encode it, and infer the MIME type from the extension (`.png`, `.jpg`, `.pdf`, `.md`, `.csv`, and so on):

```ts
import { agent } from '@gemstack/ai-sdk'
import { imageFromPath, documentFromPath } from '@gemstack/ai-sdk/node'

const chart = await imageFromPath('./reports/chart.png')
const doc   = await documentFromPath('./reports/q3.pdf')

const response = await agent('You analyze reports.')
  .prompt('Summarize the attached report and chart.', {
    attachments: [doc.toAttachment(), chart.toAttachment()],
  })
```

Both return the same `ImageAttachment` / `DocumentAttachment` instances as the byte factories, so `.toAttachment()` and `.toContentPart()` work identically. The path helpers are Node-only (they use `node:fs`); keep them out of client bundles and use `Image.fromBase64` / `Image.fromUrl` there instead.

## See also

- [Agents](/packages/ai-sdk/agents) for the `prompt()` surface and options.
- [Streaming](/packages/ai-sdk/streaming) for token-by-token output.
- [Testing](/packages/ai-sdk/testing) for asserting on structured results against the fake.
