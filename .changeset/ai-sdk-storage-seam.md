---
"@gemstack/ai-sdk": minor
---

Decouple `ImageGenerator.store()` / `AudioGenerator.store()` from `@rudderjs/storage` (epic: framework-agnostic engine).

Both `.store()` helpers no longer lazy-import `@rudderjs/storage`. They now take a required, caller-supplied storage via a new exported `StorageAdapter` contract (a one-method interface: `put(path, bytes)`). Implement it against any blob store (S3, GCS, the filesystem, a framework's storage layer).

**Breaking (0.x):** `.store(path)` is now `.store(path, storage)`. Migrate `await ImageGenerator.of(p).store('out.png')` to `await ImageGenerator.of(p).store('out.png', storage)` where `storage` satisfies `StorageAdapter`. A Rudder app wraps `@rudderjs/storage` in a ~3-line adapter.
