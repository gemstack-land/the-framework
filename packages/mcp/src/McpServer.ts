import type { McpTool } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt } from './McpPrompt.js'
import { getServerMetadata } from './decorators.js'
import type { McpResolver } from './resolver.js'

export interface McpServerMetadata {
  name?: string
  version?: string
  instructions?: string
}

export interface McpServerOptions {
  /**
   * DI resolver used to construct tool / resource / prompt classes and to
   * inject `@Handle()` method dependencies. Omit it for plain (no-DI) servers;
   * supply one (e.g. from {@link createResolver} or a framework binding) to
   * auto-wire dependencies. See {@link McpResolver}.
   */
  resolver?: McpResolver
}

/**
 * Server-initiated notification target. The runtime attaches one of these per
 * SDK session it spins up so McpServer can fan out notifications to all
 * connected clients.
 */
export interface McpNotificationTarget {
  notification(notification: { method: string; params?: Record<string, unknown> }): Promise<void> | void
}

export abstract class McpServer {
  /** Tool classes to register */
  protected tools: (new () => McpTool)[] = []

  /** Resource classes to register */
  protected resources: (new () => McpResource)[] = []

  /** Prompt classes to register */
  protected prompts: (new () => McpPrompt)[] = []

  // Lazy-initialised in attachSdk so subclasses don't need to call super().
  // Module-private would be cleaner but the runtime in another file needs to
  // attach/detach without breaking encapsulation, so we keep it on the instance.
  private _attached?: Set<McpNotificationTarget>

  // DI resolver supplied at construction. The runtime reads it (via _resolver())
  // and threads it to every @Handle call site + primitive construction.
  #resolver: McpResolver | undefined

  constructor(options: McpServerOptions = {}) {
    this.#resolver = options.resolver
  }

  /** @internal — runtime reads the DI resolver supplied at construction. */
  _resolver(): McpResolver | undefined {
    return this.#resolver
  }

  /** Server metadata — override or use decorators */
  metadata(): Required<Pick<McpServerMetadata, 'name' | 'version'>> & Pick<McpServerMetadata, 'instructions'> {
    const meta = getServerMetadata(this.constructor)
    return {
      name: meta.name ?? this.constructor.name,
      version: meta.version ?? '1.0.0',
      ...(meta.instructions != null ? { instructions: meta.instructions } : {}),
    }
  }

  /** @internal — called by the runtime when a new SDK session is connected. Returns a detach function. */
  attachSdk(target: McpNotificationTarget): () => void {
    if (!this._attached) this._attached = new Set()
    this._attached.add(target)
    return () => { this._attached?.delete(target) }
  }

  /** @internal — runtime/inspector/testing only. Exposes the protected tool classes array. */
  _tools(): (new () => McpTool)[] {
    return this.tools
  }

  /** @internal — runtime/inspector/testing only. Exposes the protected resource classes array. */
  _resources(): (new () => McpResource)[] {
    return this.resources
  }

  /** @internal — runtime/inspector/testing only. Exposes the protected prompt classes array. */
  _prompts(): (new () => McpPrompt)[] {
    return this.prompts
  }

  /** @internal — exposed for tests; counts active notification targets. */
  attachedCount(): number {
    return this._attached?.size ?? 0
  }

  /**
   * Push a notification to every attached SDK session. Errors from a single
   * target (e.g. a closed transport) are swallowed so one dead session can't
   * block the others.
   *
   * Most callers should use the higher-level helpers (`notifyResourceUpdated`,
   * `notifyToolListChanged`, etc.) — this is the escape hatch.
   */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this._attached || this._attached.size === 0) return
    for (const target of this._attached) {
      try {
        await target.notification(params !== undefined ? { method, params } : { method })
      } catch {
        // Dead transport. Drop silently — the runtime's session-close handler
        // will detach soon. Logging here would spam during normal disconnects.
      }
    }
  }

  /** Notify all connected clients that a specific resource changed. */
  async notifyResourceUpdated(uri: string): Promise<void> {
    await this.notify('notifications/resources/updated', { uri })
  }

  /** Notify all connected clients that the resource list changed (added/removed). */
  async notifyResourceListChanged(): Promise<void> {
    await this.notify('notifications/resources/list_changed')
  }

  /** Notify all connected clients that the tool list changed (added/removed). */
  async notifyToolListChanged(): Promise<void> {
    await this.notify('notifications/tools/list_changed')
  }

  /** Notify all connected clients that the prompt list changed (added/removed). */
  async notifyPromptListChanged(): Promise<void> {
    await this.notify('notifications/prompts/list_changed')
  }
}
