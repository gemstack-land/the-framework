---
'@gemstack/framework': minor
---

Read `the-framework.yml` for per-repo Open Loop defaults (#258).

A project can now carry its own domain preset + modes, so you do not retype the
flags each run:

```yaml
preset: software-development
autopilot: true
```

The CLI reads it from the run's workspace and merges it with the flags: `--preset`
wins over the file's `preset`; `--autopilot` / `--technical` OR with the file's
booleans (a flag only ever enables a mode). A missing file is a no-op and a
malformed one is a warning, never a failed run. New exports: `loadFrameworkConfig`,
`parseFrameworkConfig`, `mergeRunConfig`, `FRAMEWORK_CONFIG_FILES`,
`FrameworkFileConfig`.
