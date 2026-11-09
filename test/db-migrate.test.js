import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { openDb } from '../src/db.js'

test('openDb upgrades an older database to allow wizard versions and drafts', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'migrate-')), 'old.db')
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE watches (id TEXT PRIMARY KEY, status TEXT NOT NULL, paused_until TEXT,
      current_version INTEGER NOT NULL, origin TEXT NOT NULL, seed_hash TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE watch_versions (watch_id TEXT NOT NULL REFERENCES watches (id),
      version INTEGER NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT,
      source TEXT NOT NULL CHECK (source IN ('seed', 'edit', 'import')),
      PRIMARY KEY (watch_id, version));
    INSERT INTO watches VALUES ('k7', 'active', NULL, 1, 'seed', NULL, 'a', 'a');
    INSERT INTO watch_versions VALUES ('k7', 1, '{}', 'a', NULL, 'seed');`)
  old.close()
  const db = openDb(path)
  db.prepare(`INSERT INTO item_versions VALUES ('k7', 2, '{}', 'b', NULL, 'wizard')`).run()
  assert.deepEqual(db.prepare('SELECT version, source FROM item_versions ORDER BY version').all()
    .map((row) => ({ ...row })), [{ version: 1, source: 'seed' }, { version: 2, source: 'wizard' }])
  const columns = db.prepare('PRAGMA table_info(drafts)').all().map(({ name }) => name)
  assert.ok(['job_state', 'events_json', 'pending_change_json'].every((name) =>
    columns.includes(name)))
  db.close()
  const reopened = openDb(path)
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM item_versions').get().n, 2)
})

test('openDb lets an older runs table hold skipped runs and keeps its rows and listings',
  async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'migrate-')), 'runs.db')
    const old = new DatabaseSync(path)
    old.exec(`
      CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, watch_id TEXT NOT NULL,
        "trigger" TEXT NOT NULL CHECK ("trigger" IN ('tick', 'manual', 'dry-run')),
        slot_at TEXT, started_at TEXT NOT NULL, finished_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')), error TEXT,
        cost_usd REAL, research_json TEXT, decision_json TEXT);
      INSERT INTO runs (watch_id, "trigger", started_at, status)
        VALUES ('k7', 'tick', '2026-11-01T00:00:00Z', 'ok');`)
    old.close()
    const db = openDb(path)
    const [run] = db.prepare('SELECT * FROM runs').all()
    assert.equal(run.status, 'ok')
    assert.equal(run.item_version, 1)
    assert.equal(run.mode, 'research')
    db.prepare(`INSERT INTO runs (item_id, "trigger", started_at, status)
      VALUES ('k7', 'tick', 'b', 'skipped')`).run()
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 2)
  })

test('openDb renames the AUD price columns, adds currency, and keeps every price', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'migrate-')), 'aud.db')
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, watch_id TEXT NOT NULL,
      "trigger" TEXT NOT NULL, slot_at TEXT, started_at TEXT NOT NULL, finished_at TEXT,
      status TEXT NOT NULL, error TEXT, cost_usd REAL, research_json TEXT, decision_json TEXT);
    CREATE TABLE listings (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
      watch_id TEXT NOT NULL, checked_at TEXT NOT NULL, retailer TEXT NOT NULL, title TEXT,
      category TEXT NOT NULL, price_aud REAL, effective_price_aud REAL, was_price_aud REAL,
      delivery_aud REAL, is_clearance INTEGER NOT NULL DEFAULT 0,
      in_stock INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, url TEXT,
      qualifies INTEGER NOT NULL DEFAULT 0, reject_reason TEXT, notes TEXT);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, watch_id TEXT NOT NULL,
      run_id INTEGER, kind TEXT NOT NULL CHECK (kind IN ('deal', 'heartbeat', 'test')),
      sent_at TEXT NOT NULL, retailer TEXT, category TEXT, effective_price_aud REAL, url TEXT,
      title TEXT, message TEXT, delivered INTEGER NOT NULL DEFAULT 0, error TEXT);
    INSERT INTO runs (watch_id, "trigger", started_at, status)
      VALUES ('k7', 'tick', '2026-11-01T00:00:00Z', 'ok');
    INSERT INTO listings (run_id, watch_id, checked_at, retailer, category, price_aud,
      effective_price_aud, was_price_aud, delivery_aud)
      VALUES (1, 'k7', '2026-11-01T00:00:00Z', 'Myer', 'base', 1049, 999.5, 1299, 0);
    INSERT INTO alerts (watch_id, run_id, kind, sent_at, effective_price_aud, delivered)
      VALUES ('k7', 1, 'deal', '2026-11-01T00:00:00Z', 999.5, 1);`)
  old.close()
  const db = openDb(path)
  const listing = { ...db.prepare('SELECT * FROM listings').get() }
  assert.deepEqual(
    [listing.price, listing.effective_price, listing.was_price, listing.delivery_cost],
    [1049, 999.5, 1299, 0]
  )
  assert.equal(listing.currency, 'AUD')
  const alert = { ...db.prepare('SELECT * FROM alerts').get() }
  assert.equal(alert.effective_price, 999.5)
  assert.equal(alert.currency, 'AUD')
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name)
  assert.ok([...columns('listings'), ...columns('alerts')].every((name) => !name.endsWith('_aud')))
  db.close()
  const reopened = openDb(path)
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 1)
  assert.equal(reopened.prepare('SELECT price FROM listings').get().price, 1049)
})

test('openDb renames the watch tables and columns to items and keeps rows and links',
  async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'migrate-')), 'watches.db')
    const old = openDb(path)
    old.close()
    const legacy = new DatabaseSync(path)
    legacy.exec(LEGACY_NAMES_SQL)
    legacy.exec(`
      INSERT INTO watches VALUES ('k7', 'active', NULL, 1, 'seed', NULL, 'a', 'a');
      INSERT INTO watch_versions VALUES ('k7', 1, '{}', 'a', NULL, 'seed');
      INSERT INTO deleted_watches VALUES ('old', 'a');
      INSERT INTO runs (watch_id, "trigger", started_at, status, watch_version)
        VALUES ('k7', 'tick', 'a', 'ok', 1);
      INSERT INTO listings (run_id, watch_id, checked_at, retailer, category)
        VALUES (1, 'k7', 'a', 'Myer', 'base');
      INSERT INTO alerts (watch_id, run_id, kind, sent_at, delivered)
        VALUES ('k7', 1, 'deal', 'a', 1);
      INSERT INTO feedback (watch_id, reason, by_name, watch_version, created_at)
        VALUES ('k7', 'not-now', 'me', 1, 'a');
      INSERT INTO drafts (id, status, input_json, created_at, updated_at, watch_id)
        VALUES ('d1', 'saved', '{}', 'a', 'a', 'k7');`)
    legacy.close()
    const db = openDb(path)
    const names = (type) => db.prepare(
      'SELECT name FROM sqlite_master WHERE type = :type ORDER BY name'
    ).all({ type }).map(({ name }) => name)
    assert.ok(names('table').every((name) => !name.includes('watch')))
    assert.ok(names('index').every((name) => !name.includes('watch')))
    assert.ok(['items', 'item_versions', 'deleted_items'].every((name) =>
      names('table').includes(name)))
    for (const table of ['runs', 'listings', 'alerts', 'item_versions', 'drafts', 'feedback']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name)
      assert.ok(columns.includes('item_id'), table)
      assert.ok(columns.every((name) => !name.startsWith('watch')), table)
    }
    const joined = db.prepare(`
      SELECT i.id, v.version, r.item_version, l.retailer, a.kind, f.reason, d.id AS draft
      FROM items i JOIN item_versions v ON v.item_id = i.id JOIN runs r ON r.item_id = i.id
      JOIN listings l ON l.run_id = r.id JOIN alerts a ON a.run_id = r.id
      JOIN feedback f ON f.item_id = i.id JOIN drafts d ON d.item_id = i.id`).get()
    assert.deepEqual({ ...joined }, {
      id: 'k7', version: 1, item_version: 1, retailer: 'Myer', kind: 'deal', reason: 'not-now',
      draft: 'd1'
    })
    const [reference] = db.prepare('PRAGMA foreign_key_list(item_versions)').all()
    assert.equal(reference.table, 'items')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('SELECT id FROM deleted_items').get().id, 'old')
    db.close()
    openDb(path).close()
  })

const LEGACY_NAMES_SQL = `
  ALTER TABLE runs RENAME COLUMN item_id TO watch_id;
  ALTER TABLE runs RENAME COLUMN item_version TO watch_version;
  ALTER TABLE listings RENAME COLUMN item_id TO watch_id;
  ALTER TABLE alerts RENAME COLUMN item_id TO watch_id;
  ALTER TABLE item_versions RENAME COLUMN item_id TO watch_id;
  ALTER TABLE drafts RENAME COLUMN item_id TO watch_id;
  ALTER TABLE feedback RENAME COLUMN item_id TO watch_id;
  ALTER TABLE feedback RENAME COLUMN item_version TO watch_version;
  ALTER TABLE items RENAME TO watches;
  ALTER TABLE item_versions RENAME TO watch_versions;
  ALTER TABLE deleted_items RENAME TO deleted_watches;
  DROP INDEX runs_item_started;
  CREATE INDEX runs_watch_started ON runs (watch_id, started_at);
  DROP INDEX listings_item_checked;
  CREATE INDEX listings_watch_checked ON listings (watch_id, checked_at);
  DROP INDEX alerts_item_sent;
  CREATE INDEX alerts_watch_sent ON alerts (watch_id, sent_at);
  DROP INDEX feedback_item;
  CREATE INDEX feedback_watch ON feedback (watch_id, created_at);`
