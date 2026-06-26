/**
 * Structural type that matches the shape the MCP runtime needs from a Zod
 * object schema: a `.shape` record of nested schemas. Both Zod v3's
 * `ZodObject<ZodRawShape>` and Zod v4's `ZodObject<{...}>` satisfy this,
 * so tools / resources / prompts authored against either major version
 * type-check without a version bump in `@gemstack/mcp`.
 */
export interface ZodLikeObject {
  shape: Record<string, unknown>
}
