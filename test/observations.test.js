import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import {
  dayListings, historyRows, lastRun, lastSuccessAt, openDb, recentAlerts
} from '../src/db.js'
import { ObservationError, recordObservation } from '../src/runner.js'
import { createApp } from '../src/server.js'

const ITEM = {
  id: 'oval',
  name: 'Oval',
  enabled: true,
  schedules: [{ cron: '45 7 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 't' },
  categories: [{ id: 'base', description: 'Base' }],
  rules: { base: { maxPrice: 1600 } },
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: true }
}

const entry = (overrides = {}) => ({
  retailer: 'Harvey Norman',
  title: 'Medium Oval',
  category: 'base',
  rejectReason: null,
  price: 1798,
  wasPrice: null,
  effectivePrice: 1537.29,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://example.com/hn',
  evidence: 'Cart: $1798 less SUMMER5',
  notes: 'coupon',
  ...overrides
})

const observation = (listings = [entry()]) => ({
  checkedAt: '2026-11-07T15:45:00+11:00',
  sources: [{ name: 'Harvey Norman', status: 'ok', note: 'Chrome' }],
  listings
})

const neverDeliver = async () => assert.fail('manual import must not send ntfy')

test('recordObservation stores a manual run with qualifies, evidence and source', async () => {
  const db = openDb(':memory:')
  const result = await recordObservation({
    item: ITEM,
    data: observation([entry(), entry({ retailer: 'Myer', effectivePrice: 1700 })]),
    db, deps: { deliver: neverDeliver, log: () => {} }
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.messages.deal, null)
  assert.equal(result.delivery.deal, null)
  const rows = historyRows({ db, itemId: 'oval', days: 3650 })
  assert.equal(rows.length, 2)
  const hn = rows.find((row) => row.retailer === 'Harvey Norman')
  assert.deepEqual(
    [hn.qualifies, hn.source, hn.evidence, hn.checkedAt],
    [true, 'manual', 'Cart: $1798 less SUMMER5', '2026-11-07T04:45:00.000Z']
  )
  assert.equal(rows.find((row) => row.retailer === 'Myer').qualifies, false)
  assert.equal(recentAlerts({ db, itemId: 'oval' }).length, 0)
  assert.equal(lastRun({ db, itemId: 'oval' }).mode, 'manual')
  assert.equal(lastSuccessAt({ db, itemId: 'oval' }), null)
})

test('recordObservation rejects invalid JSON with path-prefixed errors', async () => {
  const db = openDb(':memory:')
  const bad = observation([entry({ category: 'nope' })])
  await assert.rejects(
    recordObservation({ item: ITEM, data: bad, db }),
    (error) => error instanceof ObservationError && /listings\[0\]\.category/.test(error.message)
  )
  assert.equal(lastRun({ db, itemId: 'oval' }), null)
})

test('openDb migrates an old listings table, backfills evidence, and is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pt-migrate-'))
  const path = join(dir, 'old.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, "trigger" TEXT NOT NULL,
    slot_at TEXT, mode TEXT NOT NULL DEFAULT 'research', started_at TEXT NOT NULL,
    finished_at TEXT, status TEXT NOT NULL, error TEXT, cost_usd REAL, research_json TEXT,
    decision_json TEXT)`)
  old.exec(`CREATE TABLE listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, item_id TEXT NOT NULL,
    checked_at TEXT NOT NULL, retailer TEXT NOT NULL, title TEXT, category TEXT NOT NULL,
    price REAL, effective_price REAL, was_price REAL, delivery_cost REAL,
    is_clearance INTEGER NOT NULL DEFAULT 0, in_stock INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0, url TEXT, qualifies INTEGER NOT NULL DEFAULT 0,
    reject_reason TEXT, notes TEXT)`)
  old.prepare(`INSERT INTO runs (item_id, "trigger", mode, started_at, status, research_json)
    VALUES ('oval', 'tick', 'direct', '2026-11-07T00:00:00Z', 'ok', ?)`)
    .run(JSON.stringify({ listings: [entry()] }))
  old.prepare(`INSERT INTO listings (run_id, item_id, checked_at, retailer, title, category,
    effective_price, url) VALUES (1, 'oval', '2026-11-07T00:00:00Z', 'Harvey Norman',
    'Medium Oval', 'base', 1700, 'https://example.com/hn')`).run()
  old.close()
  openDb(path).close()
  const db = openDb(path)
  const rows = db.prepare('SELECT evidence, source FROM listings').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].evidence, 'Cart: $1798 less SUMMER5')
  assert.equal(rows[0].source, 'direct')
})

const RECORD = { id: ITEM.id, status: 'active', version: 1, config: ITEM }

const withServer = async (fn) => {
  const db = openDb(':memory:')
  const app = createApp({
    db, getItems: () => [RECORD],
    now: () => new Date('2026-11-08T00:00:00Z'),
    distDir: '/nonexistent'
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({ base, db })
  } finally {
    server.close()
  }
}

const post = ({ base, body, id = 'oval' }) => fetch(`${base}/api/items/${id}/observations`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
})

test('POST observations records a manual run and the GET routes expose it', async () => {
  await withServer(async ({ base }) => {
    const created = await post({ base, body: observation() })
    assert.equal(created.status, 201)
    assert.deepEqual(await created.json(), { runId: 1, listingCount: 1, qualifiedCount: 1 })

    const insights = await (await fetch(`${base}/api/items/oval/insights?days=30`)).json()
    assert.deepEqual(
      Object.keys(insights).sort(),
      ['bestDays', 'dealWindows', 'kits', 'mutedCount', 'priceChanges', 'retailers', 'series']
    )
    assert.equal(insights.bestDays[0].evidence, 'Cart: $1798 less SUMMER5')
    assert.equal(insights.dealWindows[0].live, true)
    assert.equal(insights.retailers[0].sources[0], 'manual')

    const day = await (await fetch(`${base}/api/items/oval/observations?day=2026-11-07`)).json()
    assert.equal(day.observations.length, 1)
    assert.equal(day.observations[0].evidence, 'Cart: $1798 less SUMMER5')
    const other = await (await fetch(`${base}/api/items/oval/observations?day=2026-11-06`)).json()
    assert.deepEqual(other.observations, [])
  })
})

test('observation routes validate input and unknown items', async () => {
  await withServer(async ({ base, db }) => {
    const invalid = await post({ base, body: { checkedAt: 'x' } })
    assert.equal(invalid.status, 400)
    assert.ok((await invalid.json()).errors.length > 0)
    assert.equal((await post({ base, body: observation(), id: 'nope' })).status, 404)
    const badDay = await fetch(`${base}/api/items/oval/observations?day=yesterday`)
    assert.equal(badDay.status, 400)
    assert.equal((await fetch(`${base}/api/items/nope/insights`)).status, 404)
    assert.deepEqual(dayListings({ db, itemId: 'oval', day: '2026-11-07' }), [])
  })
})
