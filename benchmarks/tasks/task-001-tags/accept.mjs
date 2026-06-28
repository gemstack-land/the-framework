#!/usr/bin/env node
// Contract-level acceptance check for task-001-tags.
// Runs against a running benchmark app. Usage: BASE_URL=http://localhost:3000 node accept.mjs
// Exit 0 = all checks pass; non-zero = fail.

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

let cookie = ''
let failures = 0

function check(label, cond) {
  if (cond) {
    console.log(`  ok   ${label}`)
  } else {
    console.log(`  FAIL ${label}`)
    failures++
  }
}

async function req(method, path, body) {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json }
}

async function main() {
  console.log(`acceptance: task-001-tags against ${BASE}`)

  // 1. login
  const login = await req('POST', '/api/login', { email: 'demo@example.com', password: 'password' })
  check('login returns 200', login.status === 200)
  check('login set a session cookie', cookie.length > 0)

  // 2 + 3. create two tagged notes
  const a = await req('POST', '/api/notes', { title: 'Note A', body: 'Body A.', tags: ['work', 'urgent'] })
  check('create A returns 201', a.status === 201)
  const b = await req('POST', '/api/notes', { title: 'Note B', body: 'Body B.', tags: ['home'] })
  check('create B returns 201', b.status === 201)
  const aId = a.json?.note?.id
  const bId = b.json?.note?.id
  check('A has an id', typeof aId === 'number')
  check('B has an id', typeof bId === 'number')

  // 4. filter by "work" -> A only
  const work = await req('GET', '/api/notes?tag=work')
  const workIds = (work.json?.notes || []).map((n) => n.id)
  check('?tag=work returns A', workIds.includes(aId))
  check('?tag=work excludes B', !workIds.includes(bId))

  // 5. filter by "home" -> B only
  const home = await req('GET', '/api/notes?tag=home')
  const homeIds = (home.json?.notes || []).map((n) => n.id)
  check('?tag=home returns B', homeIds.includes(bId))
  check('?tag=home excludes A', !homeIds.includes(aId))

  // 6. detail includes tags
  const detail = await req('GET', `/api/notes/${aId}`)
  const tags = detail.json?.note?.tags || []
  check('detail A includes tag work', tags.includes('work'))
  check('detail A includes tag urgent', tags.includes('urgent'))

  // 7. unfiltered list returns both, each with a tags array
  const all = await req('GET', '/api/notes')
  const allNotes = all.json?.notes || []
  check('unfiltered list includes A and B', allNotes.some((n) => n.id === aId) && allNotes.some((n) => n.id === bId))
  check('every note has a tags array', allNotes.every((n) => Array.isArray(n.tags)))

  console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} check(s) failed)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('acceptance crashed:', err)
  process.exit(2)
})
