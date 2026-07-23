---
layout: home

hero:
  name: "GemStack"
  text: "Framework-agnostic tools for building AI applications in Node."
  tagline: "An agent runtime, portable skills, multi-agent orchestration, and an MCP toolkit - standalone packages that work in any Node app and compose cleanly with each other."
  image:
    src: /logo.svg
    alt: GemStack
  actions:
    - theme: brand
      text: Get Started
      link: /guide/installation
    - theme: alt
      text: What is GemStack?
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/gemstack-land/the-framework

features:
  - icon: 🧠
    title: Provider-agnostic agent runtime
    details: "Define an agent once; swap Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, and more by changing one config string. Tool calling, streaming, middleware, structured output, and memory included."
  - icon: 🧩
    title: Portable capability bundles
    details: "Ship a skill as a folder - instructions + tools + resources - and compose it onto an agent on demand. The same SKILL.md shape Claude uses."
  - icon: 🎛️
    title: Multi-agent orchestration
    details: "A Supervisor that plans, dispatches subagents under bounded concurrency and token budgets, and synthesizes the result. Pluggable plan / workers / synthesize stages."
  - icon: 🔌
    title: Model Context Protocol, both directions
    details: "Bridge agents to MCP - consume a remote server's tools or expose an agent as a server - and author standalone MCP servers with tools, resources, prompts, and OAuth 2.1."
  - icon: 🪶
    title: Zero framework lock-in
    details: "Each package works in any fetch-capable JS runtime. The agent runtime's only required dependency is zod; persistence is via neutral contracts you implement against your own infrastructure."
  - icon: 💎
    title: Graduated, not dumped
    details: "Packages join GemStack one at a time, when they prove framework-agnostic value - built in the open with the Vike team."
---
