import type { InjectToken } from './decorators.js'

/**
 * Dependency-injection seam for `@Handle()`-decorated tool / resource / prompt
 * methods (and for constructing the primitive classes themselves).
 *
 * `@gemstack/mcp` is framework-agnostic: it has no container of its own and
 * never reaches for one off `globalThis`. Instead a resolver is supplied
 * per-server at construction — `new MyServer({ resolver })` — and the runtime
 * threads it to every `@Handle` call site. Wire it to whatever container you
 * already use (Awilix, tsyringe, InversifyJS, a framework container, …) with a
 * one-function adapter, or use the built-in {@link createResolver} for the
 * no-container case.
 */
export interface McpResolver {
  /**
   * Resolve a dependency for a given token. Throwing (or returning `undefined`
   * for a `@Handle` dependency) is surfaced as a loud, named error by the
   * runtime — a resolver must never silently inject `undefined`.
   */
  resolve(token: unknown): unknown
}

/** A {@link McpResolver} with imperative registration, returned by {@link createResolver}. */
export interface MutableResolver extends McpResolver {
  /** Bind a token (class, string, or symbol) to a concrete instance. Chainable. */
  register(token: InjectToken, instance: unknown): this
}

/**
 * A minimal built-in resolver for the no-container case. Bind instances with
 * `.register(Token, instance)`; unregistered **class** tokens are constructed
 * with `new Token()` as a convenience, and unregistered string/symbol tokens
 * throw (there is nothing to construct).
 *
 * ```ts
 * const resolver = createResolver().register(Logger, new Logger())
 * const server = new MyServer({ resolver })
 * ```
 */
export function createResolver(): MutableResolver {
  const registry = new Map<unknown, unknown>()
  const resolver: MutableResolver = {
    register(token, instance) {
      registry.set(token, instance)
      return resolver
    },
    resolve(token) {
      if (registry.has(token)) return registry.get(token)
      if (typeof token === 'function') {
        return new (token as new () => unknown)()
      }
      throw new Error(
        `[gemstack/mcp] no binding registered for token ${describeToken(token)}. ` +
        `Register it with createResolver().register(token, instance).`,
      )
    },
  }
  return resolver
}

/** Human-readable token label for error messages. */
export function describeToken(token: unknown): string {
  if (typeof token === 'function') return token.name || 'anonymous class'
  if (typeof token === 'symbol') return token.toString()
  if (typeof token === 'string') return JSON.stringify(token)
  return String(token)
}
