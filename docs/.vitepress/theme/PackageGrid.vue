<script setup lang="ts">
import { withBase } from 'vitepress'

// User-facing packages only. Inclusion test: "would an app author `npm i` this
// directly?" Non-user-facing tooling/infra (e.g. the universal-* engines) stay
// off the grid so the list is signal, not noise. Grows as packages graduate.
interface Pkg {
  name: string
  description: string
  link: string
}
interface Category {
  title: string
  tagline: string
  packages: Pkg[]
}

const categories: Category[] = [
  {
    title: 'AI runtime',
    tagline: 'Build, extend, and orchestrate agents. The AI family, all on ai-sdk.',
    packages: [
      {
        name: 'ai-sdk',
        description:
          'The agent runtime: providers, the agent loop, tools, streaming, structured output, memory, and evals.',
        link: '/packages/ai-sdk/',
      },
      {
        name: 'ai-skills',
        description:
          'Portable capability bundles: load SKILL.md skills and compose them onto an agent on demand.',
        link: '/packages/ai-skills',
      },
      {
        name: 'ai-autopilot',
        description:
          'Multi-agent orchestration: a Supervisor that plans, dispatches subagents, and synthesizes the result.',
        link: '/packages/ai-autopilot',
      },
      {
        name: 'ai-mcp',
        description:
          'The agent ↔ MCP bridge: consume a remote server’s tools, or expose an agent as an MCP server.',
        link: '/packages/ai-mcp',
      },
    ],
  },
  {
    title: 'Protocol & connectors',
    tagline: 'Author MCP servers and connect agents to external services.',
    packages: [
      {
        name: 'mcp',
        description:
          'A standalone framework for authoring MCP servers: tools, resources, prompts, OAuth 2.1, a neutral HTTP handler.',
        link: '/packages/mcp',
      },
      {
        name: 'connectors',
        description:
          'The connector contract: declare a tool connector to an external service and compose any number into one MCP server.',
        link: '/packages/connectors',
      },
      {
        name: 'connector-github',
        description:
          'First-party GitHub connector: read and act on issues, pull requests, and repository files.',
        link: '/packages/connector-github',
      },
      {
        name: 'connector-google-drive',
        description:
          'First-party Google Drive connector: browse, read, and share Drive files.',
        link: '/packages/connector-google-drive',
      },
    ],
  },
]
</script>

<template>
  <div class="pkg-grid">
    <section v-for="cat in categories" :key="cat.title" class="pkg-cat">
      <header class="pkg-cat__head">
        <h2 class="pkg-cat__title">{{ cat.title }}</h2>
        <p class="pkg-cat__tagline">{{ cat.tagline }}</p>
      </header>
      <ul class="pkg-cat__list">
        <li v-for="pkg in cat.packages" :key="pkg.name">
          <a class="pkg-card" :href="withBase(pkg.link)">
            <span class="pkg-card__name">
              <span class="pkg-card__scope">@gemstack/</span>{{ pkg.name }}
            </span>
            <span class="pkg-card__desc">{{ pkg.description }}</span>
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.pkg-grid {
  margin-top: 2rem;
}
.pkg-cat + .pkg-cat {
  margin-top: 2.75rem;
}
.pkg-cat__head {
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 1rem;
}
.pkg-cat__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  border: 0;
  padding: 0;
}
.pkg-cat__tagline {
  margin: 0.25rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
.pkg-cat__list {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.pkg-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.2s, background-color 0.2s, transform 0.15s;
  text-decoration: none;
}
.pkg-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  transform: translateY(-2px);
}
.pkg-card__name {
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.pkg-card__scope {
  color: var(--vp-c-text-3);
  font-weight: 400;
}
.pkg-card__desc {
  margin-top: 8px;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  line-height: 1.5;
}
</style>
