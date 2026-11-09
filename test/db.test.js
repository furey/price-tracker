import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import {
  failStaleRuns, finishRun, getRun, hasHeartbeatThisMonth, historyRows, insertAlert,
  insertListings, normaliseStoredRetailers, lastAlert, lastAlertsFor, lastFailedRunAt, lastRun,
  lastSuccessAt, openDb,
  recentAlerts, recentRuns, runListings, startRun
} from '../src/db.js'

const ITEM = 'w1'

const newRun = ({ db, trigger = 'tick', startedAt = '2026-11-01T00:00:00.000Z' }) =>
  startRun({ db, itemId: ITEM, trigger, startedAt })

const listing = (overrides = {}) => ({
  retailer: 'Bunnings',
  title: 'K7',
  category: 'smart-control',
  price: 1000,
  effectivePrice: 950,
  wasPrice: null,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://example.com/k7',
  qualifies: true,
  ...overrides
})

test('openDb creates the schema in memory', () => {
  const db = openDb(':memory:')
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const names = tables.map(({ name }) => name)
  for (const table of ['runs', 'listings', 'alerts']) assert.ok(names.includes(table))
})

test('startRun and finishRun round trip with JSON columns', () => {
  const db = openDb(':memory:')
  const runId = newRun({ db })
  assert.equal(getRun({ db, id: runId }).status, 'running')
  finishRun({
    db,
    runId,
    status: 'ok',
    finishedAt: '2026-11-01T00:05:00.000Z',
    costUsd: 0.42,
    research: { listings: [] },
    decision: { best: null }
  })
  const run = getRun({ db, id: runId })
  assert.equal(run.status, 'ok')
  assert.equal(run.costUsd, 0.42)
  assert.deepEqual(run.research, { listings: [] })
  assert.deepEqual(run.decision, { best: null })
  assert.equal(getRun({ db, id: 999 }), null)
})

test('lastSuccessAt ignores dry-run and failed runs; lastFailedRunAt ignores dry-run', () => {
  const db = openDb(':memory:')
  const finish = (runId, status) =>
    finishRun({ db, runId, status, finishedAt: '2026-11-02T00:00:00.000Z' })
  finish(newRun({ db, startedAt: '2026-11-01T00:00:00.000Z' }), 'ok')
  finish(newRun({ db, startedAt: '2026-11-02T00:00:00.000Z', trigger: 'dry-run' }), 'ok')
  finish(newRun({ db, startedAt: '2026-11-03T00:00:00.000Z' }), 'failed')
  finish(newRun({ db, startedAt: '2026-11-04T00:00:00.000Z', trigger: 'dry-run' }), 'failed')
  assert.equal(lastSuccessAt({ db, itemId: ITEM }), '2026-11-01T00:00:00.000Z')
  assert.equal(lastFailedRunAt({ db, itemId: ITEM }), '2026-11-03T00:00:00.000Z')
  assert.equal(lastRun({ db, itemId: ITEM }).status, 'failed')
  assert.equal(lastSuccessAt({ db, itemId: 'other' }), null)
  assert.equal(lastRun({ db, itemId: 'other' }), null)
})

test('failStaleRuns marks running rows failed', () => {
  const db = openDb(':memory:')
  const runId = newRun({ db })
  assert.equal(failStaleRuns({ db, finishedAt: '2026-11-01T01:00:00.000Z' }), 1)
  const run = getRun({ db, id: runId })
  assert.equal(run.status, 'failed')
  assert.equal(run.error, 'interrupted')
})

test('insertListings stores booleans as flags and history filters rejects and out of stock', () => {
  const db = openDb(':memory:')
  const runId = newRun({ db })
  insertListings({
    db,
    runId,
    itemId: ITEM,
    checkedAt: '2026-11-01T00:00:00.000Z',
    listings: [
      listing(),
      listing({ retailer: 'Reject Co', category: 'reject', qualifies: false }),
      listing({ retailer: 'Empty Co', inStock: false, qualifies: false }),
      listing({ retailer: 'Null Co', effectivePrice: null, price: null })
    ]
  })
  const stored = runListings({ db, runId })
  assert.equal(stored.length, 4)
  assert.equal(stored[0].verified, true)
  assert.equal(stored[0].qualifies, true)
  const history = historyRows({
    db, itemId: ITEM, days: 30, now: new Date('2026-11-05T00:00:00.000Z')
  })
  assert.deepEqual(history.map((row) => row.retailer), ['Bunnings'])
  assert.equal(history[0].effectivePrice, 950)
})

test('historyRows respects the days window', () => {
  const db = openDb(':memory:')
  const runId = newRun({ db })
  const at = (checkedAt, retailer) =>
    insertListings({ db, runId, itemId: ITEM, checkedAt, listings: [listing({ retailer })] })
  at('2026-09-01T00:00:00.000Z', 'Old')
  at('2026-11-01T00:00:00.000Z', 'New')
  const rows = historyRows({ db, itemId: ITEM, days: 30, now: new Date('2026-11-05T00:00:00Z') })
  assert.deepEqual(rows.map((row) => row.retailer), ['New'])
})

test('lastAlertsFor uses delivered deal alerts only, latest per key', () => {
  const db = openDb(':memory:')
  const base = { db, itemId: ITEM, kind: 'deal', category: 'smart-control' }
  insertAlert({ ...base, retailer: 'Bunnings ', sentAt: '2026-11-01T00:00:00Z',
    effectivePrice: 1000, delivered: true })
  insertAlert({ ...base, retailer: 'bunnings', sentAt: '2026-11-02T00:00:00Z',
    effectivePrice: 900, delivered: true })
  insertAlert({ ...base, retailer: 'bunnings', sentAt: '2026-11-03T00:00:00Z',
    effectivePrice: 500, delivered: false })
  insertAlert({ ...base, retailer: 'Total Tools', kind: 'heartbeat',
    sentAt: '2026-11-03T00:00:00Z', effectivePrice: 400, delivered: true })
  const alerts = lastAlertsFor({ db, itemId: ITEM })
  assert.equal(alerts.size, 1)
  assert.deepEqual(alerts.get('bunnings|smart-control'), {
    effectivePrice: 900,
    sentAt: '2026-11-02T00:00:00Z'
  })
})

test('undelivered alerts are stored with delivered 0 and surface in lastAlert', () => {
  const db = openDb(':memory:')
  insertAlert({ db, itemId: ITEM, kind: 'deal', sentAt: '2026-11-01T00:00:00Z',
    delivered: false, error: 'down' })
  const alert = lastAlert({ db, itemId: ITEM })
  assert.equal(alert.delivered, false)
  assert.equal(alert.error, 'down')
  assert.equal(recentAlerts({ db, limit: 5 }).length, 1)
  assert.equal(recentAlerts({ db, itemId: 'other', limit: 5 }).length, 0)
})

test('hasHeartbeatThisMonth compares calendar months in the given tz', () => {
  const db = openDb(':memory:')
  insertAlert({ db, itemId: ITEM, kind: 'heartbeat', sentAt: '2026-10-31T14:30:00.000Z',
    delivered: true })
  const check = (now, tz) => hasHeartbeatThisMonth({ db, itemId: ITEM, now: new Date(now), tz })
  assert.equal(check('2026-11-15T00:00:00Z', 'Australia/Sydney'), true)
  assert.equal(check('2026-11-15T00:00:00Z', 'UTC'), false)
  assert.equal(check('2026-12-01T00:00:00Z', 'Australia/Sydney'), false)
})

test('recentRuns reports listing and qualified counts without JSON columns', () => {
  const db = openDb(':memory:')
  const runId = newRun({ db })
  insertListings({
    db,
    runId,
    itemId: ITEM,
    checkedAt: '2026-11-01T00:00:00.000Z',
    listings: [listing(), listing({ qualifies: false })]
  })
  const [run] = recentRuns({ db, itemId: ITEM, limit: 5 })
  assert.equal(run.listingCount, 2)
  assert.equal(run.qualifiedCount, 1)
  assert.equal('researchJson' in run, false)
  assert.equal(run.trigger, 'tick')
})

const OLD_RUNS_SCHEMA = `
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('tick', 'manual', 'dry-run')),
  slot_at TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  error TEXT,
  cost_usd REAL,
  research_json TEXT,
  decision_json TEXT
);
INSERT INTO runs (item_id, "trigger", started_at, status)
VALUES ('w1', 'tick', '2026-11-01T00:00:00.000Z', 'ok');`

const withOldDatabase = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'old-db-'))
  const path = join(dir, 'old.db')
  const oldDb = new DatabaseSync(path)
  oldDb.exec(OLD_RUNS_SCHEMA)
  oldDb.close()
  return fn(path)
}

test('openDb migrates an old runs table and keeps existing rows as research', async () => {
  await withOldDatabase((path) => {
    const db = openDb(path)
    const columns = db.prepare('PRAGMA table_info(runs)').all().map(({ name }) => name)
    assert.ok(columns.includes('mode'))
    assert.equal(recentRuns({ db })[0].mode, 'research')
    assert.equal(lastSuccessAt({ db, itemId: ITEM }), '2026-11-01T00:00:00.000Z')
    assert.equal(lastSuccessAt({ db, itemId: ITEM, mode: 'direct' }), null)
    db.close()
  })
})

test('openDb migration is idempotent', async () => {
  await withOldDatabase((path) => {
    openDb(path).close()
    const db = openDb(path)
    const modes = db.prepare('PRAGMA table_info(runs)').all().filter(({ name }) => name === 'mode')
    assert.equal(modes.length, 1)
    db.close()
  })
})

test('lastSuccessAt and lastFailedRunAt are tracked per mode', () => {
  const db = openDb(':memory:')
  const research = startRun({
    db, itemId: ITEM, trigger: 'tick', startedAt: '2026-11-01T00:00:00.000Z'
  })
  finishRun({ db, runId: research, status: 'ok', finishedAt: '2026-11-01T00:01:00.000Z' })
  const direct = startRun({
    db, itemId: ITEM, trigger: 'tick', startedAt: '2026-11-02T00:00:00.000Z', mode: 'direct'
  })
  finishRun({ db, runId: direct, status: 'failed', finishedAt: '2026-11-02T00:01:00.000Z' })
  assert.equal(lastSuccessAt({ db, itemId: ITEM }), '2026-11-01T00:00:00.000Z')
  assert.equal(lastSuccessAt({ db, itemId: ITEM, mode: 'direct' }), null)
  assert.equal(lastFailedRunAt({ db, itemId: ITEM }), null)
  assert.equal(lastFailedRunAt({ db, itemId: ITEM, mode: 'direct' }), '2026-11-02T00:00:00.000Z')
  assert.equal(recentRuns({ db })[0].mode, 'direct')
})

test('normaliseStoredRetailers rewrites variants once and is idempotent', () => {
  const db = openDb(':memory:')
  const runId = newRun({ db })
  const variant = 'Myer (sold by Springfree Trampoline)'
  insertListings({
    db, runId, itemId: ITEM, checkedAt: '2026-11-01T00:00:00.000Z',
    listings: [listing({ retailer: variant }), listing({ retailer: 'Myer NZ' })]
  })
  insertAlert({
    db, itemId: ITEM, runId, kind: 'deal', sentAt: '2026-11-01T00:00:00.000Z',
    retailer: variant, category: 'smart-control', effectivePrice: 900
  })
  const items = [{ id: ITEM, sources: { sites: [{ name: 'Myer' }] } }]
  assert.deepEqual(normaliseStoredRetailers({ db, items }), { listings: 1, alerts: 1 })
  assert.deepEqual(normaliseStoredRetailers({ db, items }), { listings: 0, alerts: 0 })
  const names = runListings({ db, runId }).map((row) => row.retailer).sort()
  assert.deepEqual(names, ['Myer', 'Myer NZ'])
  assert.equal(recentAlerts({ db, limit: 1 })[0].retailer, 'Myer')
})
