import {
  dataModeler,
  nextPageBuilder,
  uiIntentDesigner,
  vikeAuthComposer,
  vikeCrudComposer,
  vikeDataModeler,
  vikePageBuilder,
  vikeRbacComposer,
  vikeShellComposer,
} from '../personas/library.js'
import { defineFrameworkExtension, defineSkill } from './define.js'
import type { NeutralPersona } from './compose.js'
import type { FrameworkExtension, Skill } from './types.js'

/**
 * The built-in capability extensions — the vike-* composers, each packaged as a
 * self-describing {@link FrameworkExtension} so `run.ts` composes them through
 * the registry instead of a hardcoded, Vike-gated list. Each auto-activates when
 * its package is present in the project, and can be opted in by name for a
 * from-scratch build (where nothing is installed yet). Agnostic: a third-party
 * `framework-*` package registers the same way.
 */

/** Composes vike-auth for authentication instead of hand-rolling sessions/cookies/login. */
export const frameworkAuth: FrameworkExtension = defineFrameworkExtension({
  name: 'framework-auth',
  capability: 'auth',
  personas: [vikeAuthComposer],
  signals: { dependencies: ['vike-auth'] },
})

/** Models domain data on the universal-orm data layer (one registered adapter, no ORM install). */
export const frameworkData: FrameworkExtension = defineFrameworkExtension({
  name: 'framework-data',
  capability: 'data',
  personas: [vikeDataModeler],
  signals: { dependencies: ['@universal-orm/core', '@vike-data/vike-schema', '@vike-data/universal-schema'] },
})

/** Composes vike-rbac for roles/permissions (`can()`/`hasRole()`) instead of hand-rolled authz. */
export const frameworkRbac: FrameworkExtension = defineFrameworkExtension({
  name: 'framework-rbac',
  capability: 'rbac',
  personas: [vikeRbacComposer],
  signals: { dependencies: ['vike-rbac'] },
})

/** Composes vike-crud / vike-admin to derive CRUD + admin UI from the schema. */
export const frameworkCrud: FrameworkExtension = defineFrameworkExtension({
  name: 'framework-crud',
  capability: 'crud',
  personas: [vikeCrudComposer],
  signals: { dependencies: ['vike-crud', 'vike-admin'] },
})

/** Composes vike-themes + vike-layouts for styling and the app shell. */
export const frameworkShell: FrameworkExtension = defineFrameworkExtension({
  name: 'framework-shell',
  capability: 'shell',
  personas: [vikeShellComposer],
  signals: { dependencies: ['vike-themes', 'vike-layouts', 'vike-toolbar'] },
})

/**
 * The built-in capability extensions, in composition order (data leads so its
 * modeler frames the agent before the composers that ride on it).
 */
export function builtinExtensions(): FrameworkExtension[] {
  return [frameworkData, frameworkAuth, frameworkRbac, frameworkCrud, frameworkShell]
}

/** The names of the built-in extensions — the opt-in set behind `--compose-extensions`. */
export const builtinExtensionNames: readonly string[] = Object.freeze(builtinExtensions().map(e => e.name))

/**
 * Vike as a {@link Skill}: the whole framework rides the skill seam — its page
 * builder ({@link vikePageBuilder}) plus a doc pointer to `vike.dev/llms.txt`,
 * not a special adapter package or a preset-supplied persona. Auto-activates
 * whenever Vike is detected.
 */
export const vikeSkill: Skill = defineSkill({
  name: 'vike',
  title: 'Vike',
  description:
    'Vike is the Vite-based, renderer-agnostic meta-framework the app is built on (filesystem routing under `pages/`, `+` config files, server-side `+data` loading).',
  url: 'https://vike.dev/llms.txt',
  personas: [vikePageBuilder],
  signals: {
    dependencies: ['vike', 'vike-react', 'vike-vue', 'vike-solid'],
    files: [/(^|\/)\+Page(\.[\w-]+)?\.[jt]sx?$/, /(^|\/)\+config\.[jt]s$/],
  },
})

/**
 * Next.js as a {@link Skill}: same seam as {@link vikeSkill} — its App Router
 * page builder plus a doc pointer to `nextjs.org/llms.txt`. The second framework
 * is another skill, not a runtime fork.
 */
export const nextSkill: Skill = defineSkill({
  name: 'next',
  title: 'Next.js',
  description:
    'Next.js with the App Router (React Server Components): filesystem routing under `app/`, `page.tsx`/`layout.tsx`, server components by default, server actions for mutations.',
  url: 'https://nextjs.org/llms.txt',
  personas: [nextPageBuilder],
  signals: {
    dependencies: ['next'],
    files: [/(^|\/)next\.config\.[cm]?[jt]s$/, /(^|\/)app\/.*\/page\.[jt]sx?$/, /(^|\/)app\/layout\.[jt]sx?$/],
  },
})

/** The built-in framework skills (page builder + doc pointer), flagship first. */
export function builtinSkills(): Skill[] {
  return [vikeSkill, nextSkill]
}

/**
 * The neutral default personas, keyed by the capability an active extension
 * supersedes. `data` is the default Prisma modeler (replaced by `framework-data`);
 * `ui` is the intent-based UI guardrail (no extension owns it, so it is always on).
 */
export const neutralPersonas: readonly NeutralPersona[] = Object.freeze([
  { capability: 'data', persona: dataModeler },
  { capability: 'ui', persona: uiIntentDesigner },
])
