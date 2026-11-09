import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { createApp, startServer, trustProxyHops } from '../src/server.js'
import { validateItem } from '../src/item-validate.js'

const SECRETS = {
  SESSION_SECRET: 's'.repeat(40),
  CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret-value',
  NTFY_ACCESS_TOKEN: 'tk_global_token'
}

const itemWith = (ntfy) => ({
  id: 'k7',
  name: 'Karcher K7',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy,
  categories: [],
  rules: {}
})

const withServer = async ({ env = {}, item, deliver }, fn) => {
  const record = { id: 'k7', status: 'active', version: 1, config: item ?? itemWith({
    server: 'https://ntfy.sh', topic: 'topic-1'
  }) }
  const app = createApp({
    db: openDb(':memory:'), getItems: () => [record], env, deliver, distDir: '/nonexistent'
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, port: server.address().port })
  } finally {
    server.close()
  }
}

const sendJson = ({ base, path, method = 'POST', body = {} }) => fetch(`${base}${path}`, {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
})

const getWithHost = ({ port, host, path = '/api/session' }) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
    res.resume()
    res.on('end', () => resolve(res.statusCode))
  })
  req.on('error', reject)
  req.end()
})

test('PUT config refuses a tokenEnv outside NTFY_ names', async () => {
  const deliveries = []
  const deliver = async (call) => (deliveries.push(call), { delivered: true })
  await withServer({ env: SECRETS, deliver }, async ({ base }) => {
    for (const tokenEnv of ['SESSION_SECRET', 'CLAUDE_CODE_OAUTH_TOKEN', 'APP_PASSWORD']) {
      const config = itemWith({ server: 'https://attacker.example', topic: 'topic-1', tokenEnv })
      const response = await sendJson({
        base, path: '/api/items/k7/config', method: 'PUT', body: { config, version: 1 }
      })
      assert.equal(response.status, 400)
    }
    assert.equal(deliveries.length, 0)
  })
})

test('test-notify never sends the global token to a foreign ntfy server', async () => {
  const deliveries = []
  const deliver = async (call) => (deliveries.push(call), { delivered: true })
  const item = itemWith({ server: 'https://attacker.example', topic: 'topic-1' })
  await withServer({ env: SECRETS, deliver, item }, async ({ base }) => {
    const response = await sendJson({ base, path: '/api/items/k7/test-notify' })
    assert.equal((await response.json()).tokenWithheld, true)
    assert.equal(deliveries[0].token, null)
    assert.equal(JSON.stringify(deliveries).includes(SECRETS.SESSION_SECRET), false)
  })
})

test('test-notify sends the token to the trusted ntfy server', async () => {
  const deliveries = []
  const deliver = async (call) => (deliveries.push(call), { delivered: true })
  await withServer({ env: SECRETS, deliver }, async ({ base }) => {
    const response = await sendJson({ base, path: '/api/items/k7/test-notify' })
    assert.equal((await response.json()).tokenWithheld, false)
    assert.equal(deliveries[0].token, SECRETS.NTFY_ACCESS_TOKEN)
  })
})

test('a stored item with a hostile tokenEnv still cannot read other secrets', async () => {
  const deliveries = []
  const deliver = async (call) => (deliveries.push(call), { delivered: true })
  const ntfy = { server: 'https://ntfy.sh', topic: 'topic-1', tokenEnv: 'SESSION_SECRET' }
  const item = itemWith(ntfy)
  await withServer({ env: SECRETS, deliver, item }, async ({ base }) => {
    await sendJson({ base, path: '/api/items/k7/test-notify' })
    assert.notEqual(deliveries[0].token, SECRETS.SESSION_SECRET)
  })
})

test('validateItem checks tokenEnv and the ntfy server scheme', () => {
  const problems = (ntfy) =>
    validateItem(itemWith(ntfy), 'k7').filter((error) => error.startsWith('ntfy'))
  assert.deepEqual(problems({ server: 'https://ntfy.sh', topic: 'a', tokenEnv: 'NTFY_X' }), [])
  assert.deepEqual(problems({ server: 'http://127.0.0.1:8080', topic: 'a' }), [])
  assert.equal(problems({ server: 'http://ntfy.example', topic: 'a' }).length, 1)
  assert.equal(problems({ server: 'https://ntfy.sh', topic: 'a', tokenEnv: 'HOME' }).length, 1)
  assert.equal(problems({ server: 'https://ntfy.sh', topic: 'a', tokenEnv: 'NTFY_a' }).length, 1)
})

test('startServer refuses a public bind without a password unless ALLOW_NO_AUTH=1', async () => {
  const db = openDb(':memory:')
  await assert.rejects(startServer({ db, port: 0, host: '0.0.0.0', env: {} }), /APP_PASSWORD/)
  const open = await startServer({ db, port: 0, host: '0.0.0.0', env: { ALLOW_NO_AUTH: '1' } })
  open.close()
  const local = await startServer({ db, port: 0, host: '127.0.0.1', env: {} })
  local.close()
  const secured = { APP_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(40) }
  const guarded = await startServer({ db, port: 0, host: '0.0.0.0', env: secured })
  guarded.close()
})

test('the Host allow-list applies to reads too', async () => {
  await withServer({ env: { ALLOWED_HOSTS: 'nas.local:4280' } }, async ({ port }) => {
    assert.equal(await getWithHost({ port, host: 'evil.example:4280' }), 403)
    assert.equal(await getWithHost({ port, host: 'nas.local:4280' }), 200)
    assert.equal(await getWithHost({ port, host: `localhost:${port}` }), 200)
  })
})

test('responses carry security headers and no X-Powered-By', async () => {
  await withServer({}, async ({ base }) => {
    for (const path of ['/api/session', '/health', '/api/nope']) {
      const { headers } = await fetch(`${base}${path}`)
      assert.match(headers.get('content-security-policy'), /default-src 'self'/)
      assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/)
      assert.equal(headers.get('x-content-type-options'), 'nosniff')
      assert.equal(headers.get('referrer-policy'), 'no-referrer')
      assert.equal(headers.get('x-frame-options'), 'DENY')
      assert.equal(headers.get('x-powered-by'), null)
    }
  })
})

test('malformed JSON gets 400 and server faults get a generic 500', async () => {
  await withServer({}, async ({ base }) => {
    const bad = await fetch(`${base}/api/settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{nope'
    })
    assert.equal(bad.status, 400)
    assert.doesNotMatch((await bad.json()).error, /position|token/i)
  })
  const deliver = async () => {
    throw new Error('secret internal detail')
  }
  const originalError = console.error
  console.error = () => {}
  try {
    await withServer({ deliver, env: {} }, async ({ base }) => {
      const response = await sendJson({ base, path: '/api/items/k7/test-notify' })
      assert.equal(response.status, 500)
      assert.deepEqual(await response.json(), { error: 'Internal server error' })
    })
  } finally {
    console.error = originalError
  }
})

test('/api/about shows the database file name only', async () => {
  await withServer({}, async ({ base }) => {
    const about = await (await fetch(`${base}/api/about`)).json()
    assert.doesNotMatch(String(about.database ?? ''), /\//)
  })
})

test('trustProxyHops reads TRUST_PROXY', () => {
  assert.equal(trustProxyHops(undefined), 0)
  assert.equal(trustProxyHops('false'), 0)
  assert.equal(trustProxyHops('1'), 1)
  assert.equal(trustProxyHops('true'), 1)
  assert.equal(trustProxyHops('2'), 2)
})
