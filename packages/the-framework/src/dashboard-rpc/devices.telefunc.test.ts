import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { checkDevices } from './devices.telefunc.js'

// A throwaway daemon that answers /_relay/ping with a fixed status (or nothing on 000 = down).
async function device(status: number): Promise<{ url: string; close: () => Promise<void> }> {
  const srv: Server = createServer((_req, res) => {
    res.writeHead(status)
    res.end()
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => srv.close(() => r())) }
}

test('checkDevices maps each device id to whether it answered (#1072)', async () => {
  const up = await device(200)
  const down = await device(401)
  try {
    const result = await checkDevices([
      { id: 'up', url: up.url, token: 't' },
      { id: 'down', url: down.url, token: 't' },
      { id: 'gone', url: 'http://127.0.0.1:1', token: 't' }, // nothing listening
    ])
    assert.deepEqual(result, { up: true, down: false, gone: false })
  } finally {
    await up.close()
    await down.close()
  }
})

test('checkDevices drops malformed entries and returns {} for none (#1072)', async () => {
  assert.deepEqual(await checkDevices([]), {})
  // Bad shapes from the browser are filtered, not pinged, so they never appear in the map.
  assert.deepEqual(await checkDevices([{ id: 1 } as never, null as never]), {})
})
