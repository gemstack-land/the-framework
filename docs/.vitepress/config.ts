import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GemStack',
  description: 'Framework-agnostic tools for building AI applications in Node.',
  lang: 'en-US',
  // Served at the site root by default (local dev, and a custom domain like
  // gemstack.land). The GitHub Pages workflow sets DOCS_BASE=/gemstack/ for the
  // project-pages URL (gemstack-land.github.io/gemstack/). Drop that env once a
  // custom domain is attached so the base returns to '/'.
  base: process.env.DOCS_BASE || '/',
  ignoreDeadLinks: 'localhostLinks',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#10b981' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'GemStack',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Packages', link: '/packages/', activeMatch: '/packages/' },
      {
        text: 'Reference',
        items: [
          { text: 'Changelog', link: 'https://github.com/gemstack-land/gemstack/releases' },
          { text: 'npm — @gemstack', link: 'https://www.npmjs.com/org/gemstack' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is GemStack?', link: '/guide/' },
            { text: 'When to Use GemStack', link: '/guide/when-to-use' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Your First Agent', link: '/guide/first-agent' },
            { text: 'Build a Multi-Agent App', link: '/guide/tutorial' },
          ],
        },
        {
          text: 'Packages',
          items: [
            { text: 'Overview', link: '/packages/' },
            { text: 'ai-sdk', link: '/packages/ai-sdk/' },
            { text: 'ai-skills', link: '/packages/ai-skills' },
            { text: 'ai-autopilot', link: '/packages/ai-autopilot' },
            { text: 'ai-mcp', link: '/packages/ai-mcp' },
            { text: 'mcp', link: '/packages/mcp' },
            { text: 'orm', link: '/packages/orm' },
            { text: 'schema', link: '/packages/schema' },
          ],
        },
        {
          text: 'Project',
          items: [
            { text: 'Contributing & Graduation', link: '/guide/contributing' },
          ],
        },
      ],

      '/packages/': [
        {
          text: 'Overview',
          items: [{ text: 'The GemStack family', link: '/packages/' }],
        },
        {
          text: 'ai-sdk — the agent runtime',
          items: [
            { text: 'Overview', link: '/packages/ai-sdk/' },
            { text: 'Agents', link: '/packages/ai-sdk/agents' },
            { text: 'Tools', link: '/packages/ai-sdk/tools' },
            { text: 'Streaming', link: '/packages/ai-sdk/streaming' },
            { text: 'Structured Output', link: '/packages/ai-sdk/structured-output' },
            { text: 'Memory & Persistence', link: '/packages/ai-sdk/memory' },
            { text: 'Vector Stores & RAG', link: '/packages/ai-sdk/rag' },
            { text: 'Providers', link: '/packages/ai-sdk/providers' },
            { text: 'Testing & Evals', link: '/packages/ai-sdk/testing' },
          ],
        },
        {
          text: 'The AI family',
          items: [
            { text: 'ai-skills', link: '/packages/ai-skills' },
            { text: 'ai-autopilot', link: '/packages/ai-autopilot' },
            { text: 'ai-mcp', link: '/packages/ai-mcp' },
            { text: 'mcp', link: '/packages/mcp' },
          ],
        },
        {
          text: 'The data family',
          items: [
            { text: 'orm — the data engine', link: '/packages/orm' },
            { text: 'schema — the shape engine', link: '/packages/schema' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/gemstack-land/gemstack' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present GemStack contributors',
    },

    editLink: {
      pattern: 'https://github.com/gemstack-land/gemstack/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
    lineNumbers: true,
  },
})
