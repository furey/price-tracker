import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertListings, openDb, recentRuns, startRun } from '../src/db.js'
import { createApp } from '../src/server.js'
import { createItem, findItem } from '../src/item-store.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')

const validConfig = (overrides = {}) => ({
  id: 'demo',
  name: 'Demo',
  product: 'A demo product',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'demo-topic' },
  categories: [{ id: 'a', description: 'Category A' }],
  rules: { a: { maxPrice: 1100 } },
  sources: { sites: [{ name: 'Shop' }], searches: ['demo'] },
  ...overrides
})

const withServer = async (fn, { fetchImpl } = {}) => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  const app = createApp({ db, now: () => NOW, fetchImpl, distDir: '/nonexistent' })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const send = async ({ method = 'POST', path, body = {} }) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
  }
  const get = async (path) => (await fetch(`${base}${path}`)).json()
  try {
    await fn({ db, send, get })
  } finally {
    server.close()
  }
}

test('pause and resume change status, show in the list, and need no new version', async () => {
  await withServer(async ({ send, get }) => {
    const paused = await send({ path: '/api/items/demo/pause', body: { until: '2026-12-01' } })
    assert.equal(paused.status, 200)
    assert.equal(paused.body.status, 'paused')
    assert.equal(paused.body.pausedUntil, '2026-11-30T13:00:00.000Z')
    assert.equal(paused.body.nextSlot, '2026-11-30T21:00:00.000Z')
    const [listed] = await get('/api/items')
    assert.deepEqual([listed.status, listed.version, listed.enabled], ['paused', 1, false])
    const resumed = await send({ path: '/api/items/demo/resume' })
    assert.equal(resumed.body.status, 'active')
    assert.equal(resumed.body.pausedUntil, null)
    const past = await send({ path: '/api/items/demo/pause', body: { until: '2020-01-01' } })
    assert.equal(past.status, 400)
    assert.match(past.body.errors[0], /^until:/)
    assert.equal((await send({ path: '/api/items/nope/pause' })).status, 404)
  })
})

test('GET config returns the current version, its config, and the version list', async () => {
  await withServer(async ({ get }) => {
    const body = await get('/api/items/demo/config')
    assert.equal(body.version, 1)
    assert.equal(body.config.id, 'demo')
    assert.deepEqual(body.versions.map(({ version }) => version), [1])
    assert.deepEqual(Object.keys(body.lowestByCategory), [])
  })
})

test('PUT config saves a version, 400s on field errors, and 409s when stale', async () => {
  await withServer(async ({ send, get }) => {
    const path = '/api/items/demo/config'
    const changed = validConfig({ rules: { a: { maxPrice: 900 } } })
    const saved = await send({
      method: 'PUT', path, body: { baseVersion: 1, config: changed, note: 'Lower cap' }
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.version, 2)
    assert.equal(saved.body.versions[0].note, 'Lower cap')
    const stale = await send({ method: 'PUT', path, body: { baseVersion: 1, config: changed } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.currentVersion, 2)
    const bad = await send({
      method: 'PUT',
      path,
      body: { baseVersion: 2, config: validConfig({ rules: { a: { maxPrice: -5 } } }) }
    })
    assert.equal(bad.status, 400)
    assert.deepEqual(bad.body.errors, ['rules.a.maxPrice: expected a positive number or null'])
    const renamed = await send({
      method: 'PUT', path, body: { baseVersion: 2, config: validConfig({ id: 'other' }) }
    })
    assert.equal(renamed.status, 400)
    const missing = await send({ method: 'PUT', path, body: { config: changed } })
    assert.equal(missing.status, 400)
    const version1 = await get('/api/items/demo/versions/1')
    assert.equal(version1.config.rules.a.maxPrice, 1100)
    assert.equal(version1.source, 'edit')
  })
})

test('runs started after an edit record the new version', async () => {
  await withServer(async ({ db, send }) => {
    await send({
      method: 'PUT',
      path: '/api/items/demo/config',
      body: { baseVersion: 1, config: validConfig({ name: 'Two' }) }
    })
    const record = findItem({ db, id: 'demo', now: NOW })
    startRun({
      db, itemId: 'demo', trigger: 'manual', startedAt: NOW.toISOString(),
      itemVersion: record.version
    })
    assert.equal(recentRuns({ db, itemId: 'demo' })[0].itemVersion, 2)
  })
})

test('archive, restore, and delete follow the archive-first guard', async () => {
  await withServer(async ({ db, send, get }) => {
    const runId = startRun({ db, itemId: 'demo', trigger: 'tick', startedAt: NOW.toISOString() })
    insertListings({
      db, runId, itemId: 'demo', checkedAt: NOW.toISOString(), listings: [{ retailer: 'S' }]
    })
    const early = await send({ method: 'DELETE', path: '/api/items/demo', body: {} })
    assert.equal(early.status, 409)
    assert.equal((await send({ path: '/api/items/demo/archive' })).body.status, 'archived')
    const run = await send({ path: '/api/items/demo/run', body: { dryRun: true } })
    assert.equal(run.status, 409)
    assert.equal((await send({ path: '/api/items/demo/restore' })).body.status, 'active')
    await send({ path: '/api/items/demo/archive' })
    const wrong = await send({
      method: 'DELETE', path: '/api/items/demo', body: { confirm: 'Demo' }
    })
    assert.equal(wrong.status, 400)
    const deleted = await send({
      method: 'DELETE', path: '/api/items/demo', body: { confirm: 'demo' }
    })
    assert.equal(deleted.status, 200)
    assert.deepEqual(deleted.body.removed, { alerts: 0, listings: 1, runs: 1, versions: 1 })
    assert.deepEqual(await get('/api/items'), [])
  })
})

test('direct test fetches one URL with the entry parser and returns listings', async () => {
  const requested = []
  const fetchImpl = async (url) => {
    requested.push(url)
    const product = {
      title: 'Demo', variants: [{ title: 'Default Title', price: '899.00', available: true }]
    }
    return new Response(JSON.stringify({ product }), { status: 200 })
  }
  await withServer(async ({ send }) => {
    const entry = {
      retailer: 'Shop', url: 'https://shop.example.com.au/products/demo', category: 'new-cat',
      parser: 'shopify'
    }
    const result = await send({ path: '/api/items/demo/direct/test', body: { entry } })
    assert.equal(result.status, 200)
    assert.equal(result.body.status, 'ok')
    assert.equal(result.body.listings[0].price, 899)
    assert.deepEqual(requested, ['https://shop.example.com.au/products/demo.json'])
    const bad = await send({
      path: '/api/items/demo/direct/test',
      body: { entry: { ...entry, url: 'ftp://x', parser: 'regex' } }
    })
    assert.equal(bad.status, 400)
    assert.ok(bad.body.errors.some((error) => error.startsWith('entry.url')))
    assert.ok(bad.body.errors.some((error) => error.startsWith('entry.parser')))
    assert.equal(requested.length, 1)
  }, { fetchImpl })
})

test('direct test reports a fetch error instead of throwing', async () => {
  const fetchImpl = async () => new Response('blocked', { status: 403 })
  await withServer(async ({ send }) => {
    const entry = {
      retailer: 'Shop', url: 'https://shop.example/p/1', category: 'a', parser: 'jsonld'
    }
    const result = await send({ path: '/api/items/demo/direct/test', body: { entry } })
    assert.deepEqual(result.body, {
      status: 'blocked', note: 'HTTP 403', url: 'https://shop.example/p/1', listings: []
    })
  }, { fetchImpl })
})

test('direct test rejects a private address with 400 and never fetches', async () => {
  const requested = []
  const fetchImpl = async (url) => {
    requested.push(url)
    return new Response('{}')
  }
  await withServer(async ({ send }) => {
    for (const url of ['http://192.168.1.1:5000/', 'http://2130706433/', 'http://[::1]/']) {
      const entry = { retailer: 'Shop', url, category: 'a', parser: 'jsonld' }
      const result = await send({ path: '/api/items/demo/direct/test', body: { entry } })
      assert.equal(result.status, 400, url)
      assert.ok(result.body.errors.some((error) => error.startsWith('entry.url')), url)
    }
    assert.deepEqual(requested, [])
  }, { fetchImpl })
})

test('direct test hides the error detail of a failed fetch', async () => {
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED 203.0.113.9:443')
  }
  await withServer(async ({ send }) => {
    const entry = {
      retailer: 'Shop', url: 'https://shop.example/p/1', category: 'a', parser: 'jsonld'
    }
    const result = await send({ path: '/api/items/demo/direct/test', body: { entry } })
    assert.deepEqual(result.body, {
      status: 'error', note: 'Could not fetch that page', url: 'https://shop.example/p/1',
      listings: []
    })
  }, { fetchImpl })
})

test('GET /api/items adds a daily trend of usable prices for the top category', async () => {
  await withServer(async ({ db, get, send }) => {
    const config = validConfig({
      categories: [
        { id: 'a', description: 'Category A' }, { id: 'b', description: 'Category B' }
      ],
      rules: { a: { maxPrice: 1100 }, b: { maxPrice: 700 } }
    })
    const path = '/api/items/demo/config'
    await send({ method: 'PUT', path, body: { baseVersion: 1, config } })
    const record = (checkedAt, listings) => {
      const runId = startRun({ db, itemId: 'demo', trigger: 'tick', startedAt: checkedAt })
      insertListings({ db, runId, itemId: 'demo', checkedAt, listings })
    }
    const listing = (category, price, extra = {}) => ({
      retailer: 'Shop', category, price: price, effectivePrice: price, inStock: true,
      ...extra
    })
    record('2026-11-04T22:00:00.000Z', [listing('b', 650)])
    record('2026-11-05T01:00:00.000Z', [listing('a', 1050), listing('a', 990)])
    record('2026-11-05T09:00:00.000Z', [listing('a', 1020), listing('reject', 10)])
    record('2026-11-06T01:00:00.000Z', [
      listing('a', 1000), listing('a', 900, { url: 'https://www.costco.com.au/p/1' })
    ])
    record('2026-09-01T01:00:00.000Z', [listing('a', 500)])
    const [item] = await get('/api/items')
    assert.deepEqual(item.trend, {
      category: 'a',
      alertPrice: 1100,
      days: [
        { day: '2026-11-05', lowest: 990 },
        { day: '2026-11-06', lowest: 1000 }
      ]
    })
    assert.equal(item.dealLive, true)
  })
})

test('GET /api/items gives a null trend when no usable prices exist', async () => {
  await withServer(async ({ get }) => {
    const [item] = await get('/api/items')
    assert.equal(item.trend, null)
    assert.equal(item.dealLive, false)
  })
})

test('GET /api/about reports the app version', async () => {
  await withServer(async ({ get }) => {
    const about = await get('/api/about')
    assert.match(about.version, /^\d+\.\d+\.\d+$/)
    assert.ok('database' in about)
  })
})
