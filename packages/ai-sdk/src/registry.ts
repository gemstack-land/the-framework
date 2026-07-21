import type { AiModelConfig, ProviderFactory, ProviderAdapter, RerankingAdapter, FileAdapter, VectorStoreAdapter } from './types.js'

/**
 * Try a list of provider/model strings in order until one succeeds.
 *
 * Used by the media-generation paths (Image, Audio, Transcription) to give
 * the same failover ergonomics agents already have. The first model is the
 * "primary"; the rest are fallbacks. Errors from earlier candidates are
 * swallowed; only the last error is thrown if every candidate fails.
 *
 * The agent loop has its own failover wired into LoopContext (telemetry,
 * abort handling, observer attempts counter). This is a simpler helper for
 * single-shot calls outside the agent loop.
 *
 * @param primary    The user's chosen model string (e.g. `'openai/dall-e-3'`).
 * @param fallbacks  Additional candidates to try on failure.
 * @param call       Receives each candidate model string and runs the work.
 */
export async function tryWithFailover<T>(
  primary: string,
  fallbacks: readonly string[],
  call: (modelString: string) => Promise<T>,
): Promise<T> {
  const candidates = fallbacks.length > 0
    ? [primary, ...fallbacks.filter((m) => m !== primary)]
    : [primary]
  let lastError: Error | undefined
  for (const m of candidates) {
    try {
      return await call(m)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('[ai-sdk] No provider available for failover.')
}

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@gemstack/ai-sdk` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@gemstack/ai-sdk` inline (any agent
 * resolution path reads `AiRegistry`), but the host's provider bootstrap runs
 * from a `node_modules` copy resolved via its own discovery.
 * Without a shared store, provider factories
 * registered from the externalized copy would never be visible to
 * `AiRegistry.resolve()` from inside the bundle — every agent call would
 * throw "Unknown AI provider".
 *
 * Defensive migration per the #499 static-state singleton audit. The same
 * pattern applies to every process-wide registry here.
 */
interface AiRegistryStore {
  factories: Map<string, ProviderFactory>
  default: string | null
  models: AiModelConfig[]
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_ai_registry__']) {
  _g['__rudderjs_ai_registry__'] = {
    factories: new Map<string, ProviderFactory>(),
    default: null,
    models: [],
  } satisfies AiRegistryStore
}
const _store = _g['__rudderjs_ai_registry__'] as AiRegistryStore

// Reset listeners — modules that hold registry-shaped caches (e.g. the
// facade's embedding-adapter cache) subscribe here so `AiRegistry.reset()`
// clears them in lock-step. Survives reload via the same global slot.
if (!_g['__rudderjs_ai_reset_listeners__']) {
  _g['__rudderjs_ai_reset_listeners__'] = new Set<() => void>()
}
const _resetListeners = _g['__rudderjs_ai_reset_listeners__'] as Set<() => void>

/** Test-cleanup hook (@internal — subscribe to `AiRegistry.reset()` to clear adjacent caches. ). Kept public — other packages reset across the boundary. */
export function _onAiRegistryReset(fn: () => void): void { _resetListeners.add(fn) }

export class AiRegistry {
  /** Register a provider factory */
  static register(factory: ProviderFactory): void {
    _store.factories.set(factory.name, factory)
  }

  /** Get a registered provider factory by name */
  static getFactory(name: string): ProviderFactory {
    const f = _store.factories.get(name)
    if (!f) throw new Error(`[ai-sdk] Unknown AI provider "${name}". Register it first.`)
    return f
  }

  /** Set the default provider/model string */
  static setDefault(modelString: string): void {
    _store.default = modelString
  }

  /** Get the default provider/model string */
  static getDefault(): string {
    if (!_store.default) throw new Error('[ai-sdk] No default model set. Add ai() to providers with a config.')
    return _store.default
  }

  /** Parse 'provider/model' string into [providerName, modelId] */
  static parseModelString(modelString: string): [string, string] {
    const slash = modelString.indexOf('/')
    if (slash === -1) throw new Error(`[ai-sdk] Invalid model string "${modelString}". Expected "provider/model" format.`)
    return [modelString.slice(0, slash), modelString.slice(slash + 1)]
  }

  /** Resolve a provider/model string to a ProviderAdapter */
  static resolve(modelString: string): ProviderAdapter {
    const [providerName, model] = this.parseModelString(modelString)
    const factory = this.getFactory(providerName)
    return factory.create(model)
  }

  /** Resolve a provider/model string to a RerankingAdapter */
  static resolveReranking(modelString: string): RerankingAdapter {
    const [providerName, model] = this.parseModelString(modelString)
    const factory = this.getFactory(providerName)
    if (!factory.createReranking) {
      throw new Error(
        `[ai-sdk] Provider "${providerName}" does not support reranking. ` +
        `Use a provider that implements createReranking() (e.g. cohere, jina).`,
      )
    }
    return factory.createReranking(model)
  }

  /** Resolve a file adapter for a provider name */
  static resolveFiles(providerName: string): FileAdapter {
    const factory = this.getFactory(providerName)
    if (!factory.createFiles) {
      throw new Error(
        `[ai-sdk] Provider "${providerName}" does not support file management. ` +
        `Use a provider that implements createFiles() (e.g. openai, anthropic, google).`,
      )
    }
    return factory.createFiles()
  }

  /** Resolve a vector-store adapter for a provider name (#B8) */
  static resolveVectorStores(providerName: string): VectorStoreAdapter {
    const factory = this.getFactory(providerName)
    if (!factory.createVectorStores) {
      throw new Error(
        `[ai-sdk] Provider "${providerName}" does not support hosted vector stores. ` +
        `Use a provider that implements createVectorStores() (e.g. openai). ` +
        `For self-hosted RAG, use similaritySearch() against an ORM Model with a pgvector column.`,
      )
    }
    return factory.createVectorStores()
  }

  /** Set available models for user selection */
  static setModels(models: AiModelConfig[]): void {
    _store.models = models
  }

  /** Get available models */
  static getModels(): AiModelConfig[] {
    return _store.models
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    _store.factories.clear()
    _store.default = null
    _store.models = []
    for (const fn of _resetListeners) fn()
  }
}
