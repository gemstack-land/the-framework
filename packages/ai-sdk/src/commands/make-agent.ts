import type { MakeSpec } from '@rudderjs/console'

export const makeAgentSpec: MakeSpec = {
  command:     'make:agent',
  description: 'Create a new AI agent class',
  label:       'Agent created',
  suffix:      'Agent',
  directory:   'app/Agents',
  stub: (className) => `import { Agent } from '@gemstack/ai-sdk'
import type { HasTools, AnyTool } from '@gemstack/ai-sdk'

export class ${className} extends Agent implements HasTools {
  instructions(): string {
    return 'You are a helpful assistant.'
  }

  // model(): string | undefined { return 'anthropic/claude-sonnet-4-5' }

  tools(): AnyTool[] {
    return []
  }
}
`,
}
