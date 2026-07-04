import { defineFrameworkExtension, definePersona, defineSkill } from '@gemstack/ai-autopilot'

/**
 * A real, self-contained third-party capability extension for The Framework.
 *
 * This is what an outside author ships: a package named `framework-*` whose
 * default export is a `FrameworkExtension`. Installing it into a project is the
 * signal that turns it on (its own package name), so `@gemstack/framework`
 * discovers it, registers it, and composes its persona + skill into the agent
 * frame - with zero changes to the framework core. No build step: plain ESM.
 */
export default defineFrameworkExtension({
  name: 'framework-hello',
  capability: 'greeting',
  // Activate whenever a project installs this package.
  signals: { dependencies: ['framework-hello'] },
  personas: [
    definePersona({
      name: 'greeter',
      role: 'Adds a warm one-line greeting to the home page instead of leaving it blank',
      systemPrompt: `You own the app's first impression. When you build the home page, add a warm,
one-line greeting at the top ("Welcome - glad you're here.") styled with the
app's own tokens, never a hardcoded banner color. Keep it to a single sentence;
do not turn the home page into a marketing splash. FRAMEWORK-HELLO-SENTINEL.`,
    }),
  ],
  skills: [
    defineSkill({
      name: 'hello-guide',
      title: 'Hello Guide',
      description: 'Conventions for the greeting capability: placement, tone, and theming.',
      url: 'https://example.com/framework-hello/llms.txt',
    }),
  ],
})
