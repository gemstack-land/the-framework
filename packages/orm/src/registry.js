// The runtime adapter registry — the seam that makes the 3-package split pay off
// (#66, part of #44). Rom's design: "the app installs one adapter and hands it the
// connection; extensions stay ORM-free." The app calls `setAdapter(...)` ONCE at
// server start with its chosen backend — `@gemstack/orm-memory` for dev/test, or
// `@gemstack/orm-drizzle` for real — and every extension reads the SAME adapter via
// `getAdapter()` and builds its repository over its own schema. One app-owned
// connection serves them all; no extension imports an ORM.
//
// Cached on `globalThis` so duplicate module evaluation (pointer imports, dev HMR)
// can't fork the registry into two adapters.
import { ADAPTER_OPS } from './repository.js'

const KEY = Symbol.for('universal-orm.adapter')

// Register the app's single runtime adapter. Validated against the same ADAPTER_OPS
// contract `createRepository` enforces, so a malformed adapter fails here — at the
// app's call site — with a clear message, not later inside an extension.
export function setAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('setAdapter: expected an adapter object (e.g. createMemoryAdapter() or createDrizzleAdapter(...))')
  }
  for (const op of ADAPTER_OPS) {
    if (typeof adapter[op] !== 'function') {
      throw new Error(`setAdapter: adapter is missing the "${op}" operation`)
    }
  }
  globalThis[KEY] = adapter
}

// The registered adapter, or null if the app has not set one (callers fall back to
// the memory adapter for zero-config dev/demo/proof).
export function getAdapter() {
  return globalThis[KEY] ?? null
}

// Clear the registry (tests).
export function clearAdapter() {
  delete globalThis[KEY]
}
