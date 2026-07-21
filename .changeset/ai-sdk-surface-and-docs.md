---
'@gemstack/ai-sdk': patch
---

Tidy the public surface, drop the last brand leaks, and correct docs that contradicted the code.

- `web_search`'s fallback now extracts text with `htmlToText` instead of the `<[^>]*>` regex that the same file's docblock documents as forbidden (polynomial ReDoS, trips CodeQL). It also stops leaking `<script>` / `<style>` *content* into the model's context.
- Export types that were unnameable despite being public: `ServerToolBuilder` (the return type of `Agent.asTool()`, `scopedTool()`, `similaritySearch()` and `toolDefinition().server()`), plus `ProviderHint`, `ConversationalSpec`, `ConversationalOverride`, `ConversationStoreListEntry`, `FileSearchFallback`, `SimilaritySearchWhereOperator`, `SchemaIo` and `CachedEmbeddingOptions`.
- Replace the remaining `Rudder` references in user-visible strings: a synthesized tool-result message the *model* reads, the `User-Agent` sent by `web_search` / `web_fetch`, and error/doc copy that told `@gemstack/ai-sdk` users to rely on a framework they may not be running.
- Delete "Phase N will add …" doc comments for features that already ship in the same file (`computerUseTool`, the file-search `fallback` option), and stop a fixture-version error from telling users to re-record with a CLI command that lives in another package.
