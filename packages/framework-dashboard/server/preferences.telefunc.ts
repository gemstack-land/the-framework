// Re-export shim (#410): the user-preferences telefunctions live in @gemstack/the-framework so the
// daemon serves them in-process, reading/writing the same `the-framework.json` as the registry.
// Keeping this file at `server/preferences.telefunc.ts` means the client bakes the RPC key
// `/server/preferences.telefunc.ts` — the exact key the daemon registers the impls under (see
// framework's dashboard-rpc/register.ts). The telefunc Vite transform turns these named
// re-exports into client RPC stubs.
// Imported then exported, not re-exported (#1014): telefunc's dev transform appends
// `__decorateTelefunction(<name>, ...)` per export, which needs a local binding. An
// `export ... from` creates none, so `pnpm dev` died with `<name> is not defined`.
import {
  onPreferences,
  savePreferences,
  onProjectPreferences,
  saveProjectPreferences,
  onProjectPresets,
  saveProjectPresets,
  onEditors,
  onNotifyChannels,
  saveDiscordCredentials,
} from '@gemstack/the-framework/dashboard-rpc'

export {
  onPreferences,
  savePreferences,
  onProjectPreferences,
  saveProjectPreferences,
  onProjectPresets,
  saveProjectPresets,
  onEditors,
  onNotifyChannels,
  saveDiscordCredentials,
}
export type {
  EditorInfo,
  NotifyChannels,
  CredentialSource,
  DiscordCredentialStatus,
  DiscordCredentialsPatch,
} from '@gemstack/the-framework/dashboard-rpc'
