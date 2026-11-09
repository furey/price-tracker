import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { createApp } from '../src/server.js'

const ITEM = {
  id: 'k7',
  name: 'Karcher K7',
  enabled: true,
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'topic-1', tokenEnv: 'NTFY_PT_TOKEN' },
  categories: [],
  rules: {}
}

const ENV = { NTFY_PT_TOKEN: 'envtoken-9999', DELIVERY_POSTCODE: '2000' }

const RECORD = { id: ITEM.id, status: 'active', version: 1, config: ITEM }

const withServer = async (fn, { deliver } = {}) => {
  const db = openDb(':memory:')
  const calls = []
  const stub = deliver ?? (async (call) => {
    calls.push(call)
    return { delivered: true }
  })
  const app = createApp({
    db, getItems: () => [RECORD],
    env: ENV, deliver: stub, distDir: '/nonexistent'
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({ base, db, calls, port: server.address().port })
  } finally {
    server.close()
  }
}

const put = ({ base, body, headers = {} }) => fetch(`${base}/api/settings`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body)
})

test('GET settings reports env sources and masks the token', async () => {
  await withServer(async ({ base }) => {
    const list = await (await fetch(`${base}/api/settings`)).json()
    const token = list.find(({ key }) => key === 'ntfyToken')
    assert.equal(token.value, '••••••')
    assert.equal(token.source, 'env')
    assert.equal(list.find(({ key }) => key === 'deliveryPostcode').source, 'env')
  })
})

test('PUT settings stores overrides, clears with null, and never echoes the secret', async () => {
  await withServer(async ({ base }) => {
    const body = { ntfyToken: 'brand-new-token-wxyz', deliverySuburb: 'X' }
    const saved = await put({ base, body })
    assert.equal(saved.status, 200)
    const text = await saved.text()
    assert.equal(text.includes('brand-new-token'), false)
    const list = JSON.parse(text)
    assert.equal(list.find(({ key }) => key === 'ntfyToken').value, '••••••')
    assert.equal(list.find(({ key }) => key === 'ntfyToken').source, 'settings')
    const cleared = await (await put({ base, body: { ntfyToken: null } })).json()
    assert.equal(cleared.find(({ key }) => key === 'ntfyToken').source, 'env')
  })
})

test('PUT settings returns 400 for validation errors without echoing values', async () => {
  await withServer(async ({ base, db }) => {
    const bad = await put({ base, body: { deliveryPostcode: '12', ntfyToken: 'has space' } })
    assert.equal(bad.status, 400)
    const body = await bad.json()
    assert.equal(body.errors.length, 2)
    assert.equal(JSON.stringify(body).includes('has space'), false)
    assert.equal((await put({ base, body: [] })).status, 400)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0)
  })
})

test('state-changing routes reject a foreign Origin and a missing JSON content type', async () => {
  await withServer(async ({ base, db }) => {
    const headers = { origin: 'http://evil.example' }
    const foreign = await put({ base, body: { deliverySuburb: 'X' }, headers })
    assert.equal(foreign.status, 403)
    const sameHostOtherPort = await put({
      base, body: {}, headers: { origin: 'http://127.0.0.1:9' }
    })
    assert.equal(sameHostOtherPort.status, 403)
    const plain = await fetch(`${base}/api/settings`, {
      method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}'
    })
    assert.equal(plain.status, 415)
    const form = await fetch(`${base}/api/items/k7/test-notify`, { method: 'POST' })
    assert.equal(form.status, 415)
    const foreignRun = await fetch(`${base}/api/items/k7/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}'
    })
    assert.equal(foreignRun.status, 403)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0)
  })
})

test('own origins and the Vite dev origin are accepted', async () => {
  await withServer(async ({ base, port }) => {
    for (const origin of [
      `http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://localhost:5173'
    ]) {
      assert.equal((await put({ base, body: {}, headers: { origin } })).status, 200)
    }
  })
})

test('POST test-notify sends with the resolved token and reports delivery', async () => {
  await withServer(async ({ base, db, calls }) => {
    await put({ base, body: { ntfyToken: 'override-token-1234' } })
    const response = await fetch(`${base}/api/items/k7/test-notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })
    assert.deepEqual(await response.json(), { delivered: true, tokenWithheld: false })
    assert.equal(calls[0].token, 'override-token-1234')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'test'").get().n, 1)
    const missing = await fetch(`${base}/api/items/nope/test-notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })
    assert.equal(missing.status, 404)
  })
})

test('POST test-notify reports an undelivered notification', async () => {
  const deliver = async () => ({ delivered: false, error: 'ntfy down' })
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/items/k7/test-notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })
    assert.deepEqual(await response.json(), { delivered: false, tokenWithheld: false })
  }, { deliver })
})

test('GET items exposes the ntfy server and topic but not the token env name', async () => {
  await withServer(async ({ base }) => {
    const [item] = await (await fetch(`${base}/api/items`)).json()
    assert.deepEqual(item.ntfy, { server: 'https://ntfy.sh', topic: 'topic-1' })
  })
})
