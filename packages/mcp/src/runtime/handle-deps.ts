import { getInjectTokens, type InjectToken } from '../decorators.js'
import { type McpResolver, describeToken } from '../resolver.js'

export type Ctor<T = unknown> = new (...args: any[]) => T

/**
 * Construct a tool / resource / prompt class. When a {@link McpResolver} is
 * supplied (off the owning server), it gets first refusal so a container can
 * auto-wire constructor dependencies; a primitive with no DI needs still
 * instantiates via a plain `new Ctor()` fallback.
 *
 * If the resolver implements {@link McpResolver.has}, only tokens it owns go
 * through `resolve()`, and a genuine construction failure propagates loudly
 * rather than being masked by an un-wired `new Ctor()`. A resolver without
 * `has` keeps the legacy behavior: a `resolve` miss (throw or `undefined`)
 * falls back to a plain constructor.
 */
export function resolveOrConstruct<T>(Ctor: Ctor<T>, resolver?: McpResolver): T {
  if (resolver) {
    if (resolver.has) {
      // Precise path: don't swallow a real failure building an owned token.
      if (!resolver.has(Ctor)) return new Ctor()
      const resolved = resolver.resolve(Ctor)
      return (resolved !== undefined ? resolved : new Ctor()) as T
    }
    // Legacy path: no `has` hook — a resolver miss falls back.
    try {
      const resolved = resolver.resolve(Ctor)
      if (resolved !== undefined) return resolved as T
    } catch {
      // Resolver couldn't build it — fall back to a plain constructor.
    }
  }
  return new Ctor()
}

/**
 * Resolve the dependencies a `@Handle()`-decorated method asks for, beyond its
 * first parameter (index 0 is reserved for the tool input / resource params /
 * prompt arguments).
 *
 * Token sources, in order:
 *   1. Explicit tokens from `@Handle(Type1, Type2, …)` — always reliable.
 *   2. Fallback: `design:paramtypes` (needs `emitDecoratorMetadata` AND a build
 *      tool that honours it — plain `tsc` does; esbuild/Vite typically do not).
 *
 * When a method asks for dependencies but no resolver was provided, or the
 * resolver throws / yields `undefined`, this throws a loud error naming the
 * member and token — it never silently injects `undefined`.
 */
export function resolveHandleDeps(
  instance: object,
  propertyKey: string,
  resolver?: McpResolver,
): unknown[] {
  const tokens = injectTokensFor(instance, propertyKey)
  if (tokens.length === 0) return []

  const member = `${instance.constructor.name}.${propertyKey}()`

  if (!resolver) {
    throw new Error(
      `[gemstack/mcp] ${member} requests ${tokens.length} injected ` +
      `dependency/dependencies via @Handle, but the server was constructed without a resolver. ` +
      `Pass one — new MyServer({ resolver: createResolver().register(Token, instance) }) — ` +
      `or, in tests, new McpTestClient(Server, { resolver }).`,
    )
  }

  return tokens.map((token) => {
    let resolved: unknown
    try {
      resolved = resolver.resolve(token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `[gemstack/mcp] failed to resolve dependency ${describeToken(token)} for ${member}: ${msg}`,
        { cause: err },
      )
    }
    if (resolved === undefined) {
      throw new Error(
        `[gemstack/mcp] resolver returned undefined for dependency ${describeToken(token)} ` +
        `requested by ${member}; a resolver must never inject undefined.`,
      )
    }
    return resolved
  })
}

/** Explicit `@Handle(...)` tokens, else the `design:paramtypes` tail (index 1+). */
function injectTokensFor(instance: object, propertyKey: string): InjectToken[] {
  const explicit = getInjectTokens(instance, propertyKey)
  if (explicit && explicit.length > 0) return explicit

  const paramTypes = Reflect.getMetadata('design:paramtypes', instance, propertyKey) as
    Ctor[] | undefined
  if (!paramTypes || paramTypes.length <= 1) return []
  return paramTypes.slice(1) as InjectToken[]
}

/**
 * Resolve `shouldRegister?()` for a primitive. Items without the hook are
 * always registered. Awaits async hooks.
 */
export async function isRegistered(item: { shouldRegister?(): boolean | Promise<boolean> }): Promise<boolean> {
  if (!item.shouldRegister) return true
  return Boolean(await item.shouldRegister())
}

export async function filterRegistered<T extends { shouldRegister?(): boolean | Promise<boolean> }>(
  items: T[],
): Promise<T[]> {
  const out: T[] = []
  for (const item of items) {
    if (await isRegistered(item)) out.push(item)
  }
  return out
}
