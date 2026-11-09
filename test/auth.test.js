import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthConfigError, MAX_FAILURES, createAuth } from '../src/auth.js'
import { openDb } from '../src/db.js'
import { createApp } from '../src/server.js'

const SECURED = { APP_PASSWORD: 'correct horse', SESSION_SECRET: 'secret-one'.padEnd(40, 'x') }

const withServer = async ({ env = {}, now, ...options }, fn) => {
  const app = createApp({
    db: openDb(':memory:'), getItems: () => [], env, distDir: '/nonexistent', now, ...options
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    server.close()
  }
}

const login = (base, password, headers = {}) => fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ password })
})

const cookieFrom = (response) => response.headers.get('set-cookie').split(';')[0]

test('rejects APP_PASSWORD without SESSION_SECRET', () => {
  assert.throws(() => createAuth({ env: { APP_PASSWORD: 'x' } }), AuthConfigError)
})

test('routes need no session when APP_PASSWORD is unset', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/api/items`)).status, 200)
    const session = await (await fetch(`${base}/api/session`)).json()
    assert.deepEqual(session, {
      authRequired: false,
      authenticated: true,
      region: {
        id: 'au', country: 'Australia', currency: 'AUD', locale: 'en-AU',
        timeZone: 'Australia/Sydney'
      }
    })
  })
})

test('api routes return 401 without a session and /health stays open', async () => {
  await withServer({ env: SECURED }, async (base) => {
    assert.equal((await fetch(`${base}/api/items`)).status, 401)
    assert.equal((await fetch(`${base}/api/settings`)).status, 401)
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { ok: true })
  })
})

test('login with the right password sets a hardened cookie that grants access', async () => {
  await withServer({ env: SECURED }, async (base) => {
    const response = await login(base, 'correct horse')
    assert.equal(response.status, 200)
    const setCookie = response.headers.get('set-cookie')
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Strict/)
    assert.match(setCookie, /Max-Age=2592000/)
    assert.doesNotMatch(setCookie, /Secure/)
    const headers = { cookie: cookieFrom(response) }
    assert.equal((await fetch(`${base}/api/items`, { headers })).status, 200)
  })
})

test('login with the wrong password is refused', async () => {
  await withServer({ env: SECURED }, async (base) => {
    const response = await login(base, 'nope')
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal((await login(base, undefined)).status, 401)
  })
})

test('five failures delay the client, and the right password passes after the delay', async () => {
  let current = new Date('2026-01-01T00:00:00Z')
  await withServer({ env: SECURED, now: () => current }, async (base) => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      assert.equal((await login(base, 'bad')).status, 401)
    }
    assert.equal((await login(base, 'correct horse')).status, 429)
    current = new Date('2026-01-01T00:00:31Z')
    assert.equal((await login(base, 'correct horse')).status, 200)
  })
})

test('each further failure doubles the delay', async () => {
  let current = new Date('2026-01-01T00:00:00Z')
  await withServer({ env: SECURED, now: () => current }, async (base) => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) await login(base, 'bad')
    current = new Date('2026-01-01T00:00:31Z')
    assert.equal((await login(base, 'bad')).status, 401)
    current = new Date('2026-01-01T00:01:20Z')
    assert.equal((await login(base, 'correct horse')).status, 429)
    current = new Date('2026-01-01T00:01:32Z')
    assert.equal((await login(base, 'correct horse')).status, 200)
  })
})

test('a rotating X-Forwarded-For does not reset the delay', async () => {
  await withServer({ env: SECURED }, async (base) => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      await login(base, 'bad', { 'x-forwarded-for': `10.0.0.${attempt}` })
    }
    const response = await login(base, 'bad', { 'x-forwarded-for': '10.9.9.9' })
    assert.equal(response.status, 429)
  })
})

test('expired failure entries are pruned', () => {
  let current = new Date('2026-01-01T00:00:00Z')
  const auth = createAuth({ env: SECURED, now: () => current })
  auth.recordFailure('1.1.1.1')
  current = new Date('2026-01-01T01:00:00Z')
  auth.recordFailure('2.2.2.2')
  assert.equal(auth.isRateLimited('1.1.1.1'), false)
  assert.equal(auth.failureCount(), 1)
})

test('a short SESSION_SECRET is rejected, with or without a password', () => {
  assert.throws(() => createAuth({ env: { SESSION_SECRET: 'short' } }), AuthConfigError)
  assert.throws(
    () => createAuth({ env: { APP_PASSWORD: 'x', SESSION_SECRET: 'short' } }), AuthConfigError
  )
  assert.equal(createAuth({ env: {} }).enabled, false)
})

test('a new APP_PASSWORD cancels cookies issued under the old one', () => {
  const secret = 'k'.repeat(40)
  const first = createAuth({ env: { APP_PASSWORD: 'one', SESSION_SECRET: secret } })
  const second = createAuth({ env: { APP_PASSWORD: 'two', SESSION_SECRET: secret } })
  const cookie = first.issueCookie({ secure: false }).split(';')[0]
  const req = { headers: { cookie } }
  assert.equal(first.isAuthenticated(req), true)
  assert.equal(second.isAuthenticated(req), false)
})

test('the session cookie is Secure behind a trusted https proxy only', async () => {
  const forwarded = { 'x-forwarded-proto': 'https' }
  await withServer({ env: { ...SECURED, TRUST_PROXY: '1' } }, async (base) => {
    const response = await login(base, 'correct horse', forwarded)
    assert.match(response.headers.get('set-cookie'), /Secure/)
  })
  await withServer({ env: SECURED }, async (base) => {
    const setCookie = (await login(base, 'correct horse', forwarded)).headers.get('set-cookie')
    assert.doesNotMatch(setCookie, /Secure/)
  })
})

test('a tampered cookie is rejected', async () => {
  await withServer({ env: SECURED }, async (base) => {
    const cookie = cookieFrom(await login(base, 'correct horse'))
    const [name, value] = cookie.split('=')
    const [expiry, signature] = value.split('.')
    const forgedExpiry = `${name}=${Number(expiry) + 1000}.${signature}`
    const forgedSignature = `${name}=${expiry}.${signature.slice(0, -2)}AA`
    for (const forged of [forgedExpiry, forgedSignature, `${name}=garbage`]) {
      const response = await fetch(`${base}/api/items`, { headers: { cookie: forged } })
      assert.equal(response.status, 401)
    }
  })
})

test('a cookie signed with another secret and an expired cookie are rejected', async () => {
  let current = new Date('2026-01-01T00:00:00Z')
  await withServer({ env: SECURED, now: () => current }, async (base) => {
    const cookie = cookieFrom(await login(base, 'correct horse'))
    current = new Date('2026-03-01T00:00:00Z')
    const expired = await fetch(`${base}/api/items`, { headers: { cookie } })
    assert.equal(expired.status, 401)
  })
  const other = { ...SECURED, SESSION_SECRET: 'secret-two'.padEnd(40, 'x') }
  await withServer({ env: other }, async (base) => {
    const foreign = await withCookieFrom({ SESSION_SECRET: 'secret-one'.padEnd(40, 'x') })
    const response = await fetch(`${base}/api/items`, { headers: { cookie: foreign } })
    assert.equal(response.status, 401)
  })
})

test('logout clears the cookie', async () => {
  await withServer({ env: SECURED }, async (base) => {
    const response = await fetch(`${base}/api/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  })
})

const withCookieFrom = async (overrides) => {
  let cookie
  await withServer({ env: { ...SECURED, ...overrides } }, async (base) => {
    cookie = cookieFrom(await login(base, 'correct horse'))
  })
  return cookie
}
