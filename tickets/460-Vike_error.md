# Vike error

I'll have a look at it.

```
~/code/gemstack/packages/framework (main|u=) node dist/bin.js
◆ dashboard running: http://127.0.0.1:4200
  Ctrl+C to stop. Server logs stream below.
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/rom/code/gemstack/packages/framework-dashboard/dist/server/entry.mjs' imported from /home/rom/code/gemstack/node_modules/.pnpm/@brillout+vite-plugin-server-entry@0.7.18/node_modules/@brillout/vite-plugin-server-entry/dist/esm/runtime/autoImporter.js
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:860:10)
    at defaultResolve (node:internal/modules/esm/resolve:984:11)
    at ModuleLoader.defaultResolve (node:internal/modules/esm/loader:685:12)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:634:25)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:617:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:273:38)
    at onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:577:36)
    at TracingChannel.tracePromise (node:diagnostics_channel:344:14)
    at ModuleLoader.import (node:internal/modules/esm/loader:576:21)
```

---
Source: https://github.com/gemstack-land/the-framework/issues/460
