import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  credentialEnvVar,
  discordCredentialStatus,
  resolveDiscordCredentials,
  validateCredential,
} from './discord-credentials.js'
import { registryDiscordCredentialsStore } from './discord-credentials-store.js'
import { registryPath, type RegistryFs } from './registry.js'

// Configuring Discord from the dashboard (#1095). The two halves worth pinning are the
// precedence (an env var beats a stored value, and says so) and the contract that a value goes
// in and never comes back out.

const ENV = { HOME: '/home/u' }
const FILE = registryPath(ENV)

/** The smallest {@link RegistryFs} these need: one in-memory file, atomically renamed. */
function memFs(seed: Record<string, string> = {}): RegistryFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    async read(path) {
      const value = files.get(path)
      if (value === undefined) throw new Error(`ENOENT: ${path}`)
      return value
    },
    async write(path, contents) {
      files.set(path, contents)
    },
    async mkdir() {},
    async rename(from, to) {
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    async chmod() {},
  }
}

/** A registry file holding both credentials. */
const stored = (secrets: Record<string, string>) => ({
  [FILE]: JSON.stringify({ projects: [], preferences: {}, secrets }),
})

test('the environment wins over a stored credential (#1095)', () => {
  const secrets = { discordBotToken: 'stored-bot', discordWebhook: 'https://stored' }
  const resolved = resolveDiscordCredentials({ DISCORD_BOT_TOKEN: 'env-bot' }, secrets)

  assert.equal(resolved.botToken, 'env-bot')
  // Only the credential the environment sets is overridden; the other still resolves.
  assert.equal(resolved.webhook, 'https://stored')
})

test('a stored credential is used when the environment sets none (#1095)', () => {
  const resolved = resolveDiscordCredentials({}, { discordBotToken: 'stored-bot' })
  assert.equal(resolved.botToken, 'stored-bot')
  assert.equal(resolved.webhook, undefined)
})

test('a blank environment variable does not shadow a stored credential (#1095)', () => {
  const resolved = resolveDiscordCredentials({ DISCORD_WEBHOOK: '   ' }, { discordWebhook: 'https://stored' })
  assert.equal(resolved.webhook, 'https://stored')
})

test('the status reports where each credential came from, and nothing else (#1095)', () => {
  const status = discordCredentialStatus({ DISCORD_BOT_TOKEN: 'env-bot' }, { discordWebhook: 'https://stored' })

  assert.deepEqual(status, { botToken: 'env', webhook: 'stored' })
  // The whole presence-only contract: no field of this can be turned back into a credential.
  assert.equal(JSON.stringify(status).includes('env-bot'), false)
  assert.equal(JSON.stringify(status).includes('https://stored'), false)
})

test('an unset credential is simply absent from the status (#1095)', () => {
  assert.deepEqual(discordCredentialStatus({}, {}), {})
})

test('validation rejects what could only fail later, and accepts the rest (#1095)', () => {
  assert.equal(validateCredential('botToken', 'a-plausible-bot-token-value'), undefined)
  assert.match(validateCredential('botToken', 'short') ?? '', /too short/)
  assert.match(validateCredential('botToken', 'two words in here somewhere') ?? '', /single word/)
  assert.match(validateCredential('botToken', 'Bot a-plausible-bot-token-value') ?? '', /without the "Bot " prefix/)

  assert.equal(validateCredential('webhook', 'https://discord.com/api/webhooks/1/abc'), undefined)
  // Not tied to discord.com: a self-hosted proxy is a legitimate place to post.
  assert.equal(validateCredential('webhook', 'http://localhost:9000/hook'), undefined)
  assert.match(validateCredential('webhook', 'not a url') ?? '', /not a URL/)
  assert.match(validateCredential('webhook', 'ftp://example.com/hook') ?? '', /http or https/)

  // Clearing is legal for either — that is the Remove button.
  assert.equal(validateCredential('botToken', ''), undefined)
  assert.equal(validateCredential('webhook', '   '), undefined)
})

test('the env var name is reported for the UI copy (#1095)', () => {
  assert.equal(credentialEnvVar('botToken'), 'DISCORD_BOT_TOKEN')
  assert.equal(credentialEnvVar('webhook'), 'DISCORD_WEBHOOK')
})

test('the store saves a credential and reports it as stored afterwards (#1095)', async () => {
  const fs = memFs()
  const store = registryDiscordCredentialsStore({ env: ENV, fs })

  assert.deepEqual(await store.status(), {})
  assert.deepEqual(await store.save({ webhook: 'https://discord.com/api/webhooks/1/abc' }), { ok: true })
  assert.deepEqual(await store.status(), { webhook: 'stored' })
})

test('the store applies the save to the running daemon, after the write (#1095)', async () => {
  const fs = memFs()
  const seen: string[] = []
  const store = registryDiscordCredentialsStore({
    env: ENV,
    fs,
    // Reads the file the save just wrote: the reload must not run before the credential is there.
    onChange: () => {
      seen.push(fs.files.get(FILE)!.includes('https://hook') ? 'after-write' : 'before-write')
    },
  })

  await store.save({ webhook: 'https://hook' })
  assert.deepEqual(seen, ['after-write'])
})

test('a reload that throws does not fail the save (#1095)', async () => {
  const fs = memFs()
  const store = registryDiscordCredentialsStore({
    env: ENV,
    fs,
    onChange: () => {
      throw new Error('the gateway is down')
    },
  })

  assert.deepEqual(await store.save({ webhook: 'https://hook' }), { ok: true })
  assert.deepEqual(await store.status(), { webhook: 'stored' })
})

test('the store refuses to write a credential the environment already sets (#1095)', async () => {
  const fs = memFs()
  const store = registryDiscordCredentialsStore({ env: { ...ENV, DISCORD_WEBHOOK: 'https://env' }, fs })

  const result = await store.save({ webhook: 'https://typed' })
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.error : '', /DISCORD_WEBHOOK is set on the daemon/)
  // Nothing was written, so the next read cannot surprise anyone with a shadowed value.
  assert.equal(fs.files.has(FILE), false)
})

test('an invalid credential is refused before it is stored (#1095)', async () => {
  const fs = memFs()
  const store = registryDiscordCredentialsStore({ env: ENV, fs })

  const result = await store.save({ botToken: 'short' })
  assert.equal(result.ok, false)
  assert.equal(fs.files.has(FILE), false)
})

test('a validation failure on one credential does not half-apply the other (#1095)', async () => {
  const fs = memFs()
  const store = registryDiscordCredentialsStore({ env: ENV, fs })

  await store.save({ webhook: 'https://hook', botToken: 'short' })
  assert.deepEqual(await store.status(), {})
})

test('the store clears a stored credential (#1095)', async () => {
  const fs = memFs(stored({ discordWebhook: 'https://hook' }))
  const store = registryDiscordCredentialsStore({ env: ENV, fs })

  assert.deepEqual(await store.save({ webhook: null }), { ok: true })
  assert.deepEqual(await store.status(), {})
})

test('an env-set credential still reads as configured, so the UI can say who owns it (#1095)', async () => {
  const store = registryDiscordCredentialsStore({ env: { ...ENV, DISCORD_BOT_TOKEN: 'env-bot' }, fs: memFs() })
  assert.deepEqual(await store.status(), { botToken: 'env' })
})
