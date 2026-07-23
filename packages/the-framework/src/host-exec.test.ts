import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { hostExecutor } from './host-exec.js'

test('hostExecutor runs a command in the given cwd and captures stdout', async () => {
  const exec = hostExecutor(tmpdir())
  const result = await exec.exec(`node -e "process.stdout.write('hi from host')"`)
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /hi from host/)
})

test('hostExecutor reports a non-zero exit code without throwing', async () => {
  const exec = hostExecutor(tmpdir())
  const result = await exec.exec(`node -e "process.exit(3)"`)
  assert.equal(result.exitCode, 3)
})

test('hostExecutor merges per-command env', async () => {
  const exec = hostExecutor(tmpdir(), { env: { ...process.env, BASE_VAR: 'base' } })
  const result = await exec.exec(`node -e "process.stdout.write(process.env.BASE_VAR + ':' + process.env.EXTRA)"`, {
    env: { EXTRA: 'extra' },
  })
  assert.match(result.stdout, /base:extra/)
})
