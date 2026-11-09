import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb, recentAlerts } from '../src/db.js'
import { runItem } from '../src/runner.js'
import { createApp } from '../src/server.js'
import { createItem, saveItemConfig } from '../src/item-store.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')
const LATER = new Date('2026-11-08T00:00:00.000Z')

const config = (maxPrice) => ({
  id: 'wcm',
  name: 'Washer',
  product: 'A washer',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'wcm-topic' },
  categories: [{ id: 'premium', description: 'Premium model' }],
  rules: { premium: { maxPrice } },
  dedupe: { minDrop: 25 },
  sources: { sites: [{ name: 'Shop', url: 'https://shop.example/' }], searches: ['washer'] }
})

const researchWith = (price, checkedAt) => async () => ({
  ok: true,
  costUsd: 0.1,
  data: {
    checkedAt: checkedAt.toISOString(),
    sources: [
      { name: 'Shop', status: 'ok', note: '' },
      { name: 'Other', status: 'blocked', note: 'Blocked us' }
    ],
    listings: [{
      retailer: 'Shop', title: 'Washer X', category: 'premium', rejectReason: null,
      price: price, wasPrice: 1200, effectivePrice: price, deliveryCost: 50,
      isClearance: false, inStock: true, verified: true, url: 'https://shop.example/x',
      evidence: 'Washer X now $900', notes: 'White', part: null
    }]
  }
})

const withServer = async (fn) => {
  const db = openDb(':memory:')
  createItem({ db, config: config(950), now: NOW })
  const app = createApp({ db, now: () => LATER, distDir: '/nonexistent' })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const get = (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`)
  try {
    await fn({ db, get })
  } finally {
    server.close()
  }
}

const runAt = async ({ db, price, at, version }) => {
  const item = { ...config(950), enabled: true }
  const deps = {
    research: researchWith(price, at),
    deliver: async () => ({ delivered: true }),
    log: () => {}
  }
  await runItem({ item, itemVersion: version, now: at, db, deps })
}

test('GET /api/alerts/:id explains why the alert fired', async () => {
  await withServer(async ({ db, get }) => {
    await runAt({ db, price: 940, at: NOW, version: 1 })
    saveItemConfig({ db, id: 'wcm', baseVersion: 1, config: config(960), now: NOW })
    await runAt({ db, price: 900, at: LATER, version: 2 })
    const [latest] = recentAlerts({ db, itemId: 'wcm', limit: 1 })
    const response = await get(`/api/alerts/${latest.id}`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.alert.delivered, true)
    assert.equal(body.item.name, 'Washer')
    assert.equal(body.listing.retailer, 'Shop')
    assert.equal(body.listing.evidence, 'Washer X now $900')
    assert.equal(body.listing.deliveredTotal, 950)
    assert.equal(body.listing.source, 'research')
    assert.equal(body.why.version, 2)
    assert.equal(body.why.category, 'premium')
    assert.deepEqual(body.why.rank, { position: 1, of: 1 })
    assert.deepEqual(body.why.reasons, ['Under the $960 alert price for premium'])
    assert.equal(body.why.dedupe.previous.effectivePrice, 940)
    assert.equal(body.why.dedupe.dropAmount, 40)
    assert.equal(body.day, '2026-11-08')
    assert.equal(body.run.sources.length, 2)
    assert.equal(body.run.sources[1].status, 'blocked')
  })
})

test('GET /api/alerts/:id has no previous alert for the first one and 404s for unknown ids',
  async () => {
  await withServer(async ({ db, get }) => {
    await runAt({ db, price: 900, at: NOW, version: 1 })
    const [first] = recentAlerts({ db, itemId: 'wcm', limit: 1 })
    const body = await (await get(`/api/alerts/${first.id}`)).json()
    assert.equal(body.why.dedupe.previous, null)
    assert.equal((await get('/api/alerts/9999')).status, 404)
  })
})
