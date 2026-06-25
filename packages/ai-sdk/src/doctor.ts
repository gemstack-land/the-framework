// Doctor checks contributed by @gemstack/ai-sdk.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

// Maps provider driver name → env var the user must set. Mirrors the
// driver names listed in @gemstack/ai-sdk's provider implementations.
const PROVIDER_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  google:    'GOOGLE_AI_API_KEY',
  bedrock:   'AWS_ACCESS_KEY_ID',
  groq:      'GROQ_API_KEY',
  openrouter:'OPENROUTER_API_KEY',
  // ollama, lmstudio: local — no key needed.
}

// Extracts driver names referenced by config/ai.ts WITHOUT importing the
// module. We grep for `driver: '<name>'` literals — covers the scaffolded
// shape.
function declaredProviders(): string[] {
  const text =
    readFileSafe('config/ai.ts') ??
    readFileSafe('config/ai.js') ??
    readFileSafe('config/ai.mjs') ?? ''
  const matches = [...text.matchAll(/driver\s*:\s*['"]([^'"]+)['"]/g)]
  return [...new Set(matches.map(m => m[1]!).filter(Boolean))]
}

registerDoctorCheck({
  id:       'ai:provider-keys',
  category: 'ai',
  title:    'AI provider API keys',
  run(): DoctorResult {
    const providers = declaredProviders()
    if (providers.length === 0) {
      return { status: 'ok', message: 'no config/ai.ts or no providers declared — skip' }
    }
    const needsKey = providers.filter(p => p in PROVIDER_ENV)
    if (needsKey.length === 0) {
      return { status: 'ok', message: `${providers.length} provider(s) — all local (no keys required)` }
    }
    const missing = needsKey.filter(p => !process.env[PROVIDER_ENV[p]!])
    if (missing.length === needsKey.length) {
      return {
        status:  'warn',
        message: `none of ${needsKey.length} cloud provider(s) have an API key set`,
        fix:     `Set at least one of: ${needsKey.map(p => PROVIDER_ENV[p]).join(', ')} (or remove the providers from config/ai.ts if unused)`,
        detail:  `Declared providers: ${needsKey.join(', ')}`,
      }
    }
    if (missing.length > 0) {
      return {
        status:  'warn',
        message: `${needsKey.length - missing.length}/${needsKey.length} cloud provider(s) have keys`,
        fix:     `Set missing keys: ${missing.map(p => PROVIDER_ENV[p]).join(', ')} (or remove the providers from config/ai.ts if unused)`,
      }
    }
    return { status: 'ok', message: `${needsKey.length} cloud provider(s), all keys present` }
  },
})
