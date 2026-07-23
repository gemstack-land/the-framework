import { readSecrets, writeSecrets, type RegistryFs, type RegistrySecrets } from './registry.js'
import {
  CREDENTIALS,
  ENV_KEYS,
  SECRET_KEYS,
  discordCredentialStatus,
  validateCredential,
  type DiscordCredentialsStore,
} from './discord-credentials.js'

// The registry-backed half of the Discord credentials (#1095), split from the rules beside it
// because those are browser-safe and this reaches the home file: `client.test.ts` walks the
// import graph, so a `node:*` edge here must not be reachable from what the dashboard imports.

/**
 * A {@link DiscordCredentialsStore} backed by the registry file. `onChange` is what makes this
 * more than a write: the daemon passes its background services' reload, so a pasted token starts
 * the bot on the spot instead of at the next restart (which was the other half of what made this
 * step unfinishable from the dashboard).
 */
export function registryDiscordCredentialsStore(opts: {
  env?: NodeJS.ProcessEnv
  fs?: RegistryFs
  onChange?: () => void | Promise<void>
} = {}): DiscordCredentialsStore {
  const env = opts.env ?? process.env
  const fs = opts.fs
  return {
    async status() {
      return discordCredentialStatus(env, await readSecrets(fs, env).catch(() => ({})))
    },
    async save(patch) {
      const write: Partial<Record<keyof RegistrySecrets, string | null>> = {}
      for (const key of CREDENTIALS) {
        const value = patch[key]
        if (value === undefined) continue
        // A value set in the environment cannot be edited here: the write would land in the file
        // and be shadowed on the next read, which is worse than saying no.
        if (env[ENV_KEYS[key]]?.trim()) return { ok: false, error: `${ENV_KEYS[key]} is set on the daemon, so this is not editable here.` }
        const invalid = value === null ? undefined : validateCredential(key, value)
        if (invalid) return { ok: false, error: invalid }
        write[SECRET_KEYS[key]] = value
      }
      if (Object.keys(write).length === 0) return { ok: true }
      try {
        await writeSecrets(write, fs, env)
      } catch {
        return { ok: false, error: 'failed to save' }
      }
      // After the write, so a reload can never read the value it is replacing. A reload that
      // throws is not a failed save: the credential is stored, and the next daemon start uses it.
      // `.then(...)` rather than `Promise.resolve(onChange())`: a synchronous throw happens while
      // building that argument, so it would escape the catch and fail a save that already landed.
      await Promise.resolve()
        .then(() => opts.onChange?.())
        .catch(() => {})
      return { ok: true }
    },
  }
}
