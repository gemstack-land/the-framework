# @gemstack/example-framework-discovery

End-to-end proof of The Framework's **extension SPI** (#190): a third-party
capability package is discovered from a project and composed into the agent
frame, with no change to the framework core.

This package is a real project. Its only integration with the greeting
capability is one line in `package.json`:

```json
"dependencies": { "framework-hello": "workspace:^" }
```

[`framework-hello`](../framework-hello) is a plain third-party package whose
default export is a `FrameworkExtension`. The framework core has never heard of
it. When this project runs, the framework:

1. **discovers** it — reads this project's `package.json`, finds the `framework-*`
   dependency, and resolves + imports it from disk (the real dynamic-import path);
2. **composes** it — frames the agent with the extension's `greeter` persona and
   its `hello-guide` skill (an `llms.txt` pointer).

## Run it

```bash
pnpm start     # narrated offline demo (fake driver, no model, deterministic)
pnpm test      # the same, asserted end-to-end
```

The only thing faked is the coding agent's turns. Discovery and composition are
the exact product code a live run uses. To do it for real against Claude Code,
install `framework-hello` in your own project and run `npx @gemstack/framework`.
