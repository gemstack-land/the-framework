import { getDescription } from './decorators.js'

export abstract class McpResource {
  /** Resource URI pattern — can contain `{param}` placeholders for templates */
  abstract uri(): string

  /** MIME type */
  mimeType(): string {
    return 'text/plain'
  }

  /** Resource description */
  description(): string {
    return getDescription(this.constructor) ?? ''
  }

  /** Whether this resource uses URI templates (has `{param}` placeholders) */
  isTemplate(): boolean {
    return this.uri().includes('{')
  }

  /**
   * Handle resource read. Receives extracted params if this is a template
   * resource. Extra parameters beyond `params` are resolved from the DI
   * container when the method is decorated with `@Handle()`.
   */
  abstract handle(params?: Record<string, string>, ...deps: unknown[]): Promise<string>

  /**
   * Optional hook controlling whether this resource is exposed to clients.
   *
   * Returning `false` hides the resource from `resources/list` and
   * `resources/templates/list`, AND causes `resources/read` to throw
   * "Unknown resource" — preventing bypass via direct URI.
   */
  shouldRegister?(): boolean | Promise<boolean>
}
