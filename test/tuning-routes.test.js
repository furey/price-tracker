import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  finishRun, insertAlert, insertListings, openDb, recentAlerts, recentSiteNames, runListings,
  startRun
} from '../src/db.js'
import { alertDetail } from '../src/alert-detail.js'
import { runItem } from '../src/runner.js'
import { createApp } from '../src/server.js'
import { createItem, itemVersions } from '../src/item-store.js'

const NOW = new Date('2026-11-08T00:00:00.000Z')
const stamp = { at: NOW.toISOString(), by: 'Alex', reason: 'Not the model I want' }

const config = (overrides = {}) => ({
  id: 'k7',
  name: 'Karcher K7',
  product: 'A K7',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'k7-topic' },
  categories: [
    { id: 'premium', description: 'Premium Power Home' },
    { id: 'wcm', description: 'WCM Premium' }
  ],
  rules: { premium: { maxPrice: 950 }, wcm: { maxPrice: 950 } },
  sources: { sites: [{ name: 'Bunnings' }, { name: 'JB Hi-Fi' }], searches: ['k7'] },
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: false },
  ...overrides
})

const listing = (overrides = {}) => ({
  retailer: 'Bunnings',
  title: 'K7 WCM Premium',
  category: 'wcm',
  rejectReason: null,
  price: 640,
  wasPrice: null,
  effectivePrice: 640,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://www.bunnings.com.au/wcm',
  evidence: '$640',
  notes: '',
  ...overrides
})

const depsFor = (listings) => {
  const sent = []
  return {
    sent,
    log: () => {},
    research: async () => ({
      ok: true,
      costUsd: 0,
      data: { checkedAt: NOW.toISOString(), sources: [{ name: 'Bunnings', status: 'ok',
        note: '' }], listings }
    }),
    deliver: async ({ alert }) => {
      sent.push(alert)
      return { delivered: true }
    }
  }
}

test('a muted category run stores tuned rows and sends one price-item notice', async () => {
  const db = openDb(':memory:')
  const item = config({
    tuning: { categories: { wcm: { state: 'muted', ...stamp, notifyBelow: 650 } } }
  })
  const first = depsFor([listing()])
  const result = await runItem({ item, now: NOW, db, deps: first })
  assert.equal(result.decision.best, null)
  assert.equal(first.sent.length, 1)
  assert.equal(first.sent[0].title, 'Karcher K7: muted item below $650')
  assert.match(first.sent[0].message, /This is a muted model \(wcm\)/)
  assert.equal(first.sent[0].priority, 3)
  const [stored] = runListings({ db, runId: result.runId })
  assert.equal(stored.tuned, 'category:wcm')
  assert.equal(stored.qualifies, false)
  const [alert] = recentAlerts({ db, itemId: 'k7' })
  assert.deepEqual([alert.kind, alert.category], ['muted', 'category:wcm'])
  db.prepare('UPDATE runs SET item_version = 1').run()
  db.prepare(`INSERT INTO items VALUES ('k7', 'active', NULL, 1, 'app', NULL, 'a', 'a')`).run()
  db.prepare(`INSERT INTO item_versions VALUES ('k7', 1, :json, 'a', NULL, 'edit')`)
    .run({ json: JSON.stringify(item) })
  const detail = alertDetail({ db, id: alert.id })
  assert.equal(detail.listing.title, 'K7 WCM Premium')
  assert.equal(detail.why.muted, true)
  assert.equal(detail.why.reasons[0], 'Below your $650 price alert on the muted model wcm')
  const second = depsFor([listing()])
  await runItem({ item, now: new Date('2026-11-09T00:00:00.000Z'), db, deps: second })
  assert.equal(second.sent.length, 0)
  const unmuted = depsFor([listing()])
  await runItem({ item: config(), now: new Date('2026-11-10T00:00:00.000Z'), db,
    deps: unmuted })
  assert.equal(unmuted.sent[0].title, 'Karcher K7 deal found')
})

test('recentSiteNames lists the sites research reported in the last seven days', () => {
  const db = openDb(':memory:')
  const item = config()
  const record = (startedAt, names) => {
    const runId = startRun({ db, itemId: 'k7', trigger: 'tick', startedAt })
    finishRun({ db, runId, status: 'ok', finishedAt: startedAt, research: {
      sources: names.map((name) => ({ name, status: 'ok', note: '' })), listings: []
    } })
  }
  record('2026-10-20T00:00:00.000Z', ['JB Hi-Fi'])
  record('2026-11-05T00:00:00.000Z', ['bunnings warehouse'])
  assert.deepEqual(recentSiteNames({ db, item, now: NOW }), ['Bunnings'])
})

const withServer = async (fn) => {
  const db = openDb(':memory:')
  createItem({ db, config: config(), now: NOW })
  const app = createApp({ db, now: () => NOW, distDir: '/nonexistent' })
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

const seedPrices = (db) => {
  const runId = startRun({ db, itemId: 'k7', trigger: 'tick', startedAt: NOW.toISOString(),
    itemVersion: 1 })
  insertListings({
    db, runId, itemId: 'k7', checkedAt: '2026-11-07T21:00:00.000Z',
    listings: [
      listing({ price: 799.9, effectivePrice: 799.9 }),
      listing({ retailer: 'Tool Kit Depot', title: 'K7 Premium Power Home', category: 'premium',
        price: 1080, effectivePrice: 1080, url: 'https://tkd.example/k7' })
    ]
  })
  return insertAlert({
    db, itemId: 'k7', runId, kind: 'deal', sentAt: NOW.toISOString(), retailer: 'Bunnings',
    category: 'wcm', effectivePrice: 799.9, url: 'https://www.bunnings.com.au/wcm',
    delivered: true
  })
}

test('POST tuning mutes a model as a tune version with feedback; the card follows', async () => {
  await withServer(async ({ db, send, get }) => {
    const alertId = seedPrices(db)
    const [before] = await get('/api/items')
    assert.equal(before.lowestRecent.category, 'premium')
    const saved = await send({
      path: '/api/items/k7/tuning',
      body: {
        baseVersion: 1,
        changes: [{ kind: 'mute-category', id: 'wcm', notifyBelow: 650 }],
        by: 'Alex',
        reason: 'Not the model I want',
        feedback: { alertId, reason: 'not-this-model' }
      }
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.version, 2)
    assert.equal(saved.body.config.tuning.categories.wcm.notifyBelow, 650)
    assert.equal(itemVersions({ db, id: 'k7' })[0].source, 'tune')
    assert.equal(itemVersions({ db, id: 'k7' })[0].note, 'Not the model I want')
    const [feedback] = await get('/api/items/k7/feedback')
    assert.deepEqual([feedback.alertId, feedback.reason, feedback.by, feedback.itemVersion],
      [alertId, 'not-this-model', 'Alex', 2])
    assert.deepEqual(feedback.changes, [{ kind: 'mute-category', id: 'wcm', notifyBelow: 650 }])
    const [after] = await get('/api/items')
    assert.equal(after.tuning.categories.wcm.state, 'muted')
    assert.deepEqual([after.lowestRecent.category, after.lowestRecent.effectivePrice],
      ['premium', 1080])
    assert.equal(after.trend.category, 'premium')
    const insights = await get('/api/items/k7/insights?days=30')
    assert.equal(insights.mutedCount, 1)
    assert.ok(insights.series.some(({ category, muted }) => category === 'wcm' && muted))
  })
})

test('POST tuning rejects stale versions, unknown sites, a missing name, and bad feedback',
  async () => {
    await withServer(async ({ db, send }) => {
      const path = '/api/items/k7/tuning'
      const mute = { kind: 'mute-site', name: 'JB Hi-Fi' }
      const stale = await send({ path, body: { baseVersion: 3, changes: [mute], by: 'Alex' } })
      assert.equal(stale.status, 409)
      const unknown = await send({ path, body: {
        baseVersion: 1, changes: [{ kind: 'mute-site', name: 'Myer' }], by: 'Alex'
      } })
      assert.equal(unknown.status, 400)
      assert.match(unknown.body.error, /site "Myer" is not in this item/)
      const anonymous = await send({ path, body: { baseVersion: 1, changes: [mute] } })
      assert.equal(anonymous.status, 400)
      const everything = await send({ path, body: {
        baseVersion: 1,
        changes: [{ kind: 'mute-category', id: 'wcm' }, { kind: 'mute-category', id: 'premium' }],
        by: 'Alex'
      } })
      assert.equal(everything.status, 400)
      assert.match(everything.body.errors.join(' '), /keep at least one category unmuted/)
      const badFeedback = await send({ path, body: {
        baseVersion: 1, changes: [mute], by: 'Alex', feedback: { reason: 'meh' }
      } })
      assert.equal(badFeedback.status, 400)
      const muted = await send({ path, body: { baseVersion: 1, changes: [mute], by: 'Sam' } })
      assert.equal(muted.status, 200)
      assert.equal(muted.body.config.tuning.sites['JB Hi-Fi'].by, 'Sam')
      assert.equal(muted.body.feedbackId, null)
      assert.equal((await send({ path: '/api/items/nope/tuning', body: {} })).status, 404)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0)
    })
  })

test('POST feedback records an opinion without a new version', async () => {
  await withServer(async ({ db, send, get }) => {
    const alertId = seedPrices(db)
    const saved = await send({ path: '/api/items/k7/feedback', body: {
      alertId, reason: 'not-now', note: 'Wait for Black Friday', by: 'Sam'
    } })
    assert.equal(saved.status, 201)
    const [entry] = await get('/api/items/k7/feedback')
    assert.deepEqual([entry.reason, entry.note, entry.by, entry.itemVersion],
      ['not-now', 'Wait for Black Friday', 'Sam', 1])
    assert.equal(itemVersions({ db, id: 'k7' }).length, 1)
    const noName = await send({ path: '/api/items/k7/feedback', body: { reason: 'not-now' } })
    assert.equal(noName.status, 400)
    const wrongAlert = await send({ path: '/api/items/k7/feedback', body: {
      alertId: 999, reason: 'not-now', by: 'Alex'
    } })
    assert.equal(wrongAlert.status, 400)
  })
})
