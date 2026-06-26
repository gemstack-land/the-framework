// Barrel re-exporting the runtime's sibling modules. Each sibling owns one
// concern: SDK wiring, the framework-neutral HTTP handler, DI helpers,
// tool-return consumption, observer-registry access. Touch the siblings — this
// file is intentionally thin so external consumers (bindings, testing,
// telescope) keep their `from './runtime.js'` / `from '../runtime.js'` imports
// stable.

export { createSdkServer, startStdio } from './runtime/sdk-server.js'
export { createWebRequestHandler, type WebRequestHandlerOptions } from './runtime/web-handler.js'
export { createMcpHttpHandler } from './runtime/node-handler.js'
export { consumeToolReturn } from './runtime/consume-tool-return.js'
export { resolveOrConstruct, resolveHandleDeps, isRegistered, filterRegistered } from './runtime/handle-deps.js'
