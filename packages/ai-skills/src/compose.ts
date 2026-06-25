import type { AnyTool, AiMiddleware } from '@gemstack/ai-sdk'
import type { LoadedSkill, SkillSurface } from './types.js'

/**
 * Compose an agent's base identity with the instructions from its skills.
 *
 * The agent's own `base` comes first and is authoritative — it is the identity
 * the rest layers under. Each skill's body follows in declaration order under a
 * `# Skill: <name>` header so the model can tell capabilities apart. Skills with
 * an empty body contribute tools/resources only and add nothing here.
 */
export function composeInstructions(base: string, skills: LoadedSkill[]): string {
  const blocks = skills
    .filter(s => s.instructions.trim().length > 0)
    .map(s => `# Skill: ${s.manifest.name}\n\n${s.instructions.trim()}`)
  return [base.trim(), ...blocks].filter(s => s.length > 0).join('\n\n')
}

/**
 * Union an agent's own tools with the tools from its skills.
 *
 * Precedence is unambiguous: the agent's own tools come first and win every
 * name collision. A skill tool whose name is already taken (by an own tool or an
 * earlier skill) is kept but **namespaced** as `<skill>__<tool>` so nothing is
 * silently dropped — the loader's namespacing is the backstop the agent's
 * authority rests on.
 */
export function composeTools(own: AnyTool[], skills: LoadedSkill[]): AnyTool[] {
  const out: AnyTool[] = [...own]
  const used = new Set(own.map(t => t.definition.name))

  for (const skill of skills) {
    for (const tool of skill.tools) {
      const name = tool.definition.name
      if (!used.has(name)) {
        used.add(name)
        out.push(tool)
        continue
      }
      // Collision — namespace it rather than drop it.
      let candidate = `${sanitize(skill.manifest.name)}__${name}`
      let n = 2
      while (used.has(candidate)) candidate = `${sanitize(skill.manifest.name)}__${name}__${n++}`
      used.add(candidate)
      out.push(renameTool(tool, candidate))
    }
  }
  return out
}

/**
 * Append the middleware contributed by skills to the agent's own middleware.
 * Agent middleware runs first. Most skills contribute none.
 */
export function composeMiddleware(own: AiMiddleware[], skills: LoadedSkill[]): AiMiddleware[] {
  const skillMw = skills.flatMap(s => s.middleware ?? [])
  return skillMw.length > 0 ? [...own, ...skillMw] : [...own]
}

/**
 * Summarize what a skill would add to an agent — instructions size, tool names,
 * resource names — without composing it. Use this to report a skill's surface
 * before attaching it (the "surface-before-compose" half of the trust model).
 */
export function surface(skill: LoadedSkill): SkillSurface {
  const s: SkillSurface = {
    name: skill.manifest.name,
    description: skill.manifest.description,
    instructionChars: skill.instructions.length,
    toolNames: skill.tools.map(t => t.definition.name),
    resourceNames: skill.resources.map(r => r.name),
  }
  if (skill.manifest.trigger !== undefined) s.trigger = skill.manifest.trigger
  return s
}

/** Surface a list of skills. */
export function surfaceAll(skills: LoadedSkill[]): SkillSurface[] {
  return skills.map(surface)
}

// ─── Internals ───────────────────────────────────────────────────

/** Constrain a name to the `[a-zA-Z0-9_-]` set providers accept for tool names. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Clone a tool with a new advertised name, preserving execute + modelOutput. */
function renameTool(tool: AnyTool, name: string): AnyTool {
  return { ...tool, definition: { ...tool.definition, name } }
}
