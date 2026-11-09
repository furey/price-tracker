import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import {
  finishRun, historyRows, insertListings, openDb, recentRuns, startRun
} from '../src/db.js'
import { buildInsights } from '../src/insights.js'
import { tick } from '../src/runner.js'
import {
  ItemError, archiveItem, createItem, deleteItem, exportConfig, findItem, pauseItem,
  pinSeeds, restoreItem, resumeItem, rotateTopic, rulesByVersion, runnableItems,
  saveItemConfig, seedItems, itemRecords, itemVersions
} from '../src/item-store.js'

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
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: false },
  ...overrides
})

const seedDir = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seeds-'))
  writeSeeds({ dir, files })
  return dir
}

const writeSeeds = ({ dir, files }) => {
  for (const [name, config] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), JSON.stringify(config, null, 2))
  }
}

const collectLog = () => {
  const lines = []
  return { lines, log: (line) => lines.push(line) }
}

test('openDb adds runs.item_version to an old database and backfills version 1', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'olddb-')), 'old.db')
  const old = new DatabaseSync(file)
  old.exec(`CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL,
    "trigger" TEXT NOT NULL, slot_at TEXT, started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL, error TEXT, cost_usd REAL, research_json TEXT, decision_json TEXT)`)
  old.exec(`INSERT INTO runs (item_id, "trigger", started_at, status)
    VALUES ('k7', 'tick', '2026-11-01T00:00:00.000Z', 'ok')`)
  old.close()
  const db = openDb(file)
  assert.equal(recentRuns({ db, itemId: 'k7' })[0].itemVersion, 1)
  db.close()
  const again = openDb(file)
  const tables = again.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  for (const name of ['items', 'item_versions', 'deleted_items']) {
    assert.ok(tables.some((table) => table.name === name), name)
  }
  assert.equal(recentRuns({ db: again, itemId: 'k7' })[0].itemVersion, 1)
})

test('seeding imports new files as version 1 and maps enabled false to paused', () => {
  const db = openDb(':memory:')
  const dir = seedDir({
    'demo.json': { ...validConfig(), enabled: true },
    'off.json': { ...validConfig({ id: 'off' }), enabled: false }
  })
  const { lines, log } = collectLog()
  const outcomes = seedItems({ db, dir, now: NOW, log })
  assert.deepEqual(outcomes.map(({ action }) => action), ['created', 'created'])
  const demo = findItem({ db, id: 'demo', now: NOW })
  assert.equal(demo.status, 'active')
  assert.equal(demo.origin, 'seed')
  assert.equal(demo.version, 1)
  assert.equal('enabled' in demo.config, false)
  assert.equal(findItem({ db, id: 'off', now: NOW }).status, 'paused')
  assert.equal(itemVersions({ db, id: 'demo' })[0].source, 'seed')
  assert.equal(lines.length, 2)
  assert.deepEqual(seedItems({ db, dir, now: NOW, log }).map(({ action }) => action),
    ['unchanged', 'unchanged'])
})

test('a changed seed adds a version when the item was never edited in the app', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig() })
  seedItems({ db, dir, now: NOW })
  writeSeeds({ dir, files: { 'demo.json': validConfig({ name: 'Demo renamed' }) } })
  const [outcome] = seedItems({ db, dir, now: NOW })
  assert.equal(outcome.action, 'updated')
  const record = findItem({ db, id: 'demo', now: NOW })
  assert.equal(record.version, 2)
  assert.equal(record.config.name, 'Demo renamed')
  assert.deepEqual(itemVersions({ db, id: 'demo' }).map(({ source }) => source), ['seed', 'seed'])
})

test('a changed seed is ignored with a warning when the item was edited in the app', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig() })
  seedItems({ db, dir, now: NOW })
  saveItemConfig({
    db, id: 'demo', baseVersion: 1, config: validConfig({ name: 'App name' }), now: NOW
  })
  writeSeeds({ dir, files: { 'demo.json': validConfig({ name: 'Git name' }) } })
  const { lines, log } = collectLog()
  const [outcome] = seedItems({ db, dir, now: NOW, log })
  assert.equal(outcome.action, 'conflict')
  assert.equal(findItem({ db, id: 'demo', now: NOW }).config.name, 'App name')
  assert.match(lines[0], /WARNING seed demo\.json changed/)
})

test('an exported config copied back into git is adopted without a new version', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig() })
  seedItems({ db, dir, now: NOW })
  saveItemConfig({
    db, id: 'demo', baseVersion: 1, config: validConfig({ name: 'App name' }), now: NOW
  })
  const exported = JSON.parse(exportConfig(findItem({ db, id: 'demo', now: NOW }).config))
  writeSeeds({ dir, files: { 'demo.json': exported } })
  assert.equal(seedItems({ db, dir, now: NOW })[0].action, 'unchanged')
  assert.equal(findItem({ db, id: 'demo', now: NOW }).version, 2)
})

test('invalid seed files are skipped and logged, not fatal', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig(), 'bad.json': validConfig({ id: 'other' }) })
  writeFileSync(path.join(dir, 'broken.json'), '{ nope')
  const { lines, log } = collectLog()
  const outcomes = seedItems({ db, dir, now: NOW, log })
  assert.deepEqual(outcomes.map(({ action }) => action), ['invalid', 'invalid', 'created'])
  assert.ok(lines.some((line) => line.includes('bad.json')))
  assert.ok(lines.some((line) => line.includes('broken.json')))
})

test('a deleted seed item is tombstoned and never re-seeded', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig() })
  seedItems({ db, dir, now: NOW })
  archiveItem({ db, id: 'demo', now: NOW })
  deleteItem({ db, id: 'demo', confirm: 'demo', now: NOW })
  assert.equal(seedItems({ db, dir, now: NOW })[0].action, 'deleted')
  assert.equal(findItem({ db, id: 'demo', now: NOW }), null)
})

test('pause until a Sydney date hides the item from tick and resumes it on that date', () => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  const paused = pauseItem({ db, id: 'demo', until: '2026-12-01', now: NOW })
  assert.equal(paused.status, 'paused')
  assert.equal(paused.pausedUntil, '2026-11-30T13:00:00.000Z')
  assert.equal(paused.version, 1)
  assert.equal(itemVersions({ db, id: 'demo' }).length, 1)
  assert.deepEqual(runnableItems({ db, now: NOW }), [])
  const before = new Date('2026-11-30T12:59:00.000Z')
  assert.equal(itemRecords({ db, now: before })[0].status, 'paused')
  const after = new Date('2026-11-30T13:00:00.000Z')
  const [record] = itemRecords({ db, now: after })
  assert.equal(record.status, 'active')
  assert.equal(record.pausedUntil, null)
})

test('pause without a date stays paused until resumed', () => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  pauseItem({ db, id: 'demo', now: NOW })
  const later = new Date('2027-06-01T00:00:00.000Z')
  assert.equal(findItem({ db, id: 'demo', now: later }).status, 'paused')
  assert.equal(resumeItem({ db, id: 'demo', now: later }).status, 'active')
})

test('pause rejects a past date and an archived item', () => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  assert.throws(() => pauseItem({ db, id: 'demo', until: '2026-01-01', now: NOW }),
    (error) => error instanceof ItemError && error.code === 'invalid')
  assert.throws(() => pauseItem({ db, id: 'demo', until: 'soon', now: NOW }), /YYYY-MM-DD/)
  archiveItem({ db, id: 'demo', now: NOW })
  assert.throws(() => pauseItem({ db, id: 'demo', now: NOW }), /archived/)
  assert.throws(() => resumeItem({ db, id: 'demo', now: NOW }), /archived/)
  assert.equal(restoreItem({ db, id: 'demo', now: NOW }).status, 'active')
})

test('tick skips paused and archived items', async () => {
  const db = openDb(':memory:')
  for (const id of ['live', 'held', 'gone']) {
    createItem({ db, config: validConfig({ id, ntfy: { server: 'https://ntfy.sh', topic: id } }) })
  }
  pauseItem({ db, id: 'held', now: NOW })
  archiveItem({ db, id: 'gone', now: NOW })
  const researched = []
  const deps = {
    research: async ({ item }) => {
      researched.push(item.id)
      return { ok: false, errors: ['offline'] }
    },
    deliver: async () => ({ delivered: true })
  }
  const lockPath = path.join(await mkdtemp(path.join(tmpdir(), 'tick-')), 'tick.lock')
  const outcomes = await tick({ now: NOW, db, deps, log: () => {}, lockPath })
  assert.deepEqual(researched, ['live'])
  assert.deepEqual(outcomes.map(({ itemId }) => itemId), ['live'])
  assert.equal(recentRuns({ db, itemId: 'live' })[0].itemVersion, 1)
})

test('saving a config validates, rejects a stale base version, and keeps id fixed', () => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  const saved = saveItemConfig({
    db, id: 'demo', baseVersion: 1, config: validConfig({ name: 'New' }), note: ' cap ', now: NOW
  })
  assert.equal(saved.version, 2)
  assert.equal(itemVersions({ db, id: 'demo' })[0].note, 'cap')
  assert.throws(
    () => saveItemConfig({ db, id: 'demo', baseVersion: 1, config: validConfig(), now: NOW }),
    (error) => error.code === 'conflict' && error.details.currentVersion === 2
  )
  assert.throws(
    () => saveItemConfig({
      db, id: 'demo', baseVersion: 2, config: validConfig({ id: 'renamed' }), now: NOW
    }),
    (error) => error.code === 'invalid' && /id: cannot change/.test(error.errors[0])
  )
  assert.throws(
    () => saveItemConfig({
      db, id: 'demo', baseVersion: 2, config: validConfig({ name: 'New', categories: [] }), now: NOW
    }),
    (error) => error.code === 'invalid' && error.errors.some((e) => e.startsWith('categories'))
  )
  assert.throws(
    () => saveItemConfig({
      db, id: 'demo', baseVersion: 2, config: validConfig({ name: 'New' }), now: NOW
    }),
    /No changes/
  )
})

test('delete needs an archived item and the typed id, and removes its history', () => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  createItem({ db, config: validConfig({ id: 'keep' }), now: NOW })
  for (const itemId of ['demo', 'keep']) {
    const runId = startRun({ db, itemId, trigger: 'tick', startedAt: NOW.toISOString() })
    insertListings({
      db, runId, itemId, checkedAt: NOW.toISOString(), listings: [{ retailer: 'Shop' }]
    })
  }
  assert.throws(() => deleteItem({ db, id: 'demo', confirm: 'demo', now: NOW }), /Archive/)
  archiveItem({ db, id: 'demo', now: NOW })
  assert.throws(() => deleteItem({ db, id: 'demo', confirm: 'Demo', now: NOW }), /confirm/)
  const removed = deleteItem({ db, id: 'demo', confirm: 'demo', now: NOW })
  assert.deepEqual(removed, { alerts: 0, listings: 1, runs: 1, versions: 1 })
  assert.equal(recentRuns({ db, itemId: 'keep' }).length, 1)
  assert.deepEqual(itemRecords({ db, now: NOW }).map(({ id }) => id), ['keep'])
})

test('insights judge each listing by the rules of the version its run used', () => {
  const db = openDb(':memory:')
  createItem({ db, config: validConfig(), now: NOW })
  const listing = {
    retailer: 'Shop', title: 'Demo', category: 'a', price: 1000, effectivePrice: 1000,
    inStock: true, verified: true, url: 'https://shop.example/demo'
  }
  const runId = startRun({
    db, itemId: 'demo', trigger: 'tick', startedAt: NOW.toISOString(), itemVersion: 1
  })
  finishRun({ db, runId, status: 'ok', finishedAt: NOW.toISOString() })
  insertListings({
    db, runId, itemId: 'demo', checkedAt: NOW.toISOString(), listings: [listing]
  })
  const lowered = validConfig({ rules: { a: { maxPrice: 900 } } })
  const record = saveItemConfig({ db, id: 'demo', baseVersion: 1, config: lowered, now: NOW })
  const rows = historyRows({ db, itemId: 'demo', days: 30, now: NOW })
  assert.equal(rows[0].itemVersion, 1)
  const insights = buildInsights({
    rows, item: record.config, now: NOW, rulesByVersion: rulesByVersion({ db, itemId: 'demo' })
  })
  assert.equal(insights.dealWindows.length, 1)
  const rejudged = buildInsights({ rows, item: record.config, now: NOW })
  assert.equal(rejudged.dealWindows.length, 0)
})

test('rotating a topic saves a new random topic and pins a placeholder seed', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig() })
  seedItems({ db, dir, now: NOW })
  writeSeeds({ dir, files: { 'demo.json': validConfig({
    ntfy: { server: 'https://ntfy.sh', topic: 'change-me-demo' }
  }) } })
  const rotated = rotateTopic({ db, id: 'demo', dir, now: NOW })
  assert.match(rotated.config.ntfy.topic, /^pt-demo-[0-9a-f]{32}$/)
  assert.equal(rotated.version, 2)
  assert.deepEqual(seedItems({ db, dir, now: NOW }).map(({ action }) => action), ['unchanged'])
  assert.equal(findItem({ db, id: 'demo', now: NOW }).config.ntfy.topic, rotated.config.ntfy.topic)
})

test('rotated topics stay within the ntfy length limit for long item ids', () => {
  const db = openDb(':memory:')
  const id = 'a-very-long-item-id-that-goes-on-and-on-forever'
  createItem({ db, config: validConfig({ id }), now: NOW })
  const { config } = rotateTopic({ db, id, dir: seedDir({}), now: NOW })
  assert.ok(config.ntfy.topic.length <= 64)
  assert.match(config.ntfy.topic, /^pt-a-very-long-item-id[a-z-]*[a-z]-[0-9a-f]{32}$/)
})

test('pinning seeds stops conflict warnings without changing the item', () => {
  const db = openDb(':memory:')
  const dir = seedDir({ 'demo.json': validConfig() })
  seedItems({ db, dir, now: NOW })
  saveItemConfig({
    db, id: 'demo', baseVersion: 1, config: validConfig({ name: 'Edited' }), now: NOW
  })
  writeSeeds({ dir, files: { 'demo.json': validConfig({ product: 'Renamed key' }) } })
  assert.deepEqual(seedItems({ db, dir, now: NOW }).map(({ action }) => action), ['conflict'])
  assert.deepEqual(pinSeeds({ db, dir }), ['demo'])
  assert.deepEqual(seedItems({ db, dir, now: NOW }).map(({ action }) => action), ['unchanged'])
  assert.equal(findItem({ db, id: 'demo', now: NOW }).config.name, 'Edited')
})
