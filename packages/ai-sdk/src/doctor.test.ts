import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Side-effect import: registers `ai:provider-keys`.
import './doctor.js'
import { getRegisteredChecks, type DoctorResult } from '@rudderjs/console'

const CHECK_ID = 'ai:provider-keys'
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_AI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
]

let tmpDir: string
let originalCwd: string
const savedEnv: Record<string, string | undefined> = {}

before(() => {
  originalCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-doctor-'))
})
after(() => {
  process.chdir(originalCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true })
  process.chdir(tmpDir)
  for (const k of PROVIDER_ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  process.chdir(originalCwd)
  for (const k of PROVIDER_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function writeConfig(body: string): void {
  fs.writeFileSync(path.join(tmpDir, 'config/ai.ts'), body, 'utf-8')
}

async function runCheck(): Promise<DoctorResult> {
  const check = getRegisteredChecks().find(c => c.id === CHECK_ID)
  assert.ok(check, `expected ${CHECK_ID} to be registered`)
  return check.run()
}

describe('ai:provider-keys doctor check', () => {
  it('warns (not errors) when a single cloud provider is declared with no key set', async () => {
    writeConfig(`export default { default: 'anthropic', providers: { anthropic: { driver: 'anthropic' } } }`)
    const result = await runCheck()
    assert.strictEqual(result.status, 'warn')
    assert.match(result.message, /1 cloud provider/)
    assert.match(result.fix ?? '', /ANTHROPIC_API_KEY/)
  })

  it('warns when 3 cloud providers are declared with no keys set, listing all 3 env vars', async () => {
    writeConfig(`export default {
      providers: {
        a: { driver: 'anthropic' },
        b: { driver: 'openai' },
        c: { driver: 'google' },
      }
    }`)
    const result = await runCheck()
    assert.strictEqual(result.status, 'warn')
    assert.match(result.fix ?? '', /ANTHROPIC_API_KEY/)
    assert.match(result.fix ?? '', /OPENAI_API_KEY/)
    assert.match(result.fix ?? '', /GOOGLE_AI_API_KEY/)
    // Parenthetical mirrors the "some missing" branch for consistency.
    assert.match(result.fix ?? '', /remove the providers from config\/ai\.ts if unused/)
  })

  it('warns when one of multiple cloud providers has a key (unchanged "partial" branch)', async () => {
    writeConfig(`export default {
      providers: {
        a: { driver: 'anthropic' },
        b: { driver: 'openai' },
      }
    }`)
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const result = await runCheck()
    assert.strictEqual(result.status, 'warn')
    assert.match(result.message, /1\/2/)
    assert.match(result.fix ?? '', /OPENAI_API_KEY/)
  })

  it('is ok when all declared cloud providers have keys set', async () => {
    writeConfig(`export default {
      providers: {
        a: { driver: 'anthropic' },
        b: { driver: 'openai' },
      }
    }`)
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.OPENAI_API_KEY = 'sk-test'
    const result = await runCheck()
    assert.strictEqual(result.status, 'ok')
  })

  it('is ok when there is no config/ai.ts at all', async () => {
    const result = await runCheck()
    assert.strictEqual(result.status, 'ok')
  })

  it('is ok when only local providers (ollama) are declared', async () => {
    writeConfig(`export default { providers: { local: { driver: 'ollama' } } }`)
    const result = await runCheck()
    assert.strictEqual(result.status, 'ok')
  })
})
