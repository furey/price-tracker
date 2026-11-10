import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DB_PATH } from './config.js'
import { dedupeKey } from './decide.js'
import { parseStoredJson } from './legacy-keys.js'
import { DEFAULT_REGION } from './regions/index.js'
import { canonicalRetailer, knownRetailersFor } from './retailers.js'

export const DRAFT_STATUSES = [
  'describing', 'scoping', 'clarifying', 'researching', 'review', 'testing', 'saved', 'failed',
  'cancelled'
]

const quoteList = (values) => values.map((value) => `'${value}'`).join(', ')
const VERSION_SOURCES = quoteList(['seed', 'edit', 'import', 'wizard', 'tune'])
const ALERT_KINDS = quoteList(['deal', 'heartbeat', 'test', 'muted', 'check'])
const DRAFT_STATUS_LIST = quoteList(DRAFT_STATUSES)
const RUN_STATUS_LIST = quoteList(['running', 'ok', 'failed', 'skipped'])

export const FEEDBACK_REASONS = ['not-this-model', 'not-this-product', 'price-too-high', 'not-now']

export const DRAFT_EXTRA_COLUMNS = {
  job: 'TEXT',
  job_state: 'TEXT',
  job_started_at: 'TEXT',
  error_kind: 'TEXT',
  failed_step: 'TEXT',
  resets_at: 'TEXT',
  rounds: 'INTEGER NOT NULL DEFAULT 0',
  events_json: 'TEXT',
  pending_change_json: 'TEXT',
  test_json: 'TEXT',
  run_anyway: 'INTEGER NOT NULL DEFAULT 0',
  cost_usd: 'REAL NOT NULL DEFAULT 0',
  duplicate_of: 'TEXT'
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('tick', 'manual', 'dry-run')),
  slot_at TEXT,
  mode TEXT NOT NULL DEFAULT 'research',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN (${RUN_STATUS_LIST})),
  error TEXT,
  cost_usd REAL,
  research_json TEXT,
  decision_json TEXT,
  item_version INTEGER
);
CREATE INDEX IF NOT EXISTS runs_item_started ON runs (item_id, started_at);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs (id),
  item_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  retailer TEXT NOT NULL,
  title TEXT,
  category TEXT NOT NULL,
  price REAL,
  effective_price REAL,
  was_price REAL,
  delivery_cost REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  is_clearance INTEGER NOT NULL DEFAULT 0,
  in_stock INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  qualifies INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT,
  notes TEXT,
  evidence TEXT,
  source TEXT NOT NULL DEFAULT 'research',
  part TEXT,
  tuned TEXT
);
CREATE INDEX IF NOT EXISTS listings_item_checked ON listings (item_id, checked_at);
CREATE INDEX IF NOT EXISTS listings_run ON listings (run_id);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  run_id INTEGER REFERENCES runs (id),
  kind TEXT NOT NULL CHECK (kind IN (${ALERT_KINDS})),
  sent_at TEXT NOT NULL,
  retailer TEXT,
  category TEXT,
  effective_price REAL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  url TEXT,
  title TEXT,
  message TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS alerts_item_sent ON alerts (item_id, sent_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
  paused_until TEXT,
  current_version INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('seed', 'app')),
  seed_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_versions (
  item_id TEXT NOT NULL REFERENCES items (id),
  version INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL CHECK (source IN (${VERSION_SOURCES})),
  PRIMARY KEY (item_id, version)
);
CREATE TABLE IF NOT EXISTS deleted_items (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN (${DRAFT_STATUS_LIST})),
  input_json TEXT NOT NULL,
  questions_json TEXT,
  answers_json TEXT,
  draft_config_json TEXT,
  research_json TEXT,
  snapshot_json TEXT,
  session_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  item_id TEXT
);
CREATE INDEX IF NOT EXISTS drafts_status ON drafts (status, updated_at);
CREATE TABLE IF NOT EXISTS claude_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_name TEXT NOT NULL,
  utilization REAL,
  resets_at TEXT,
  status TEXT,
  rate_limit_type TEXT,
  is_using_overage INTEGER,
  overage_status TEXT,
  raw_json TEXT,
  read_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT
);
CREATE INDEX IF NOT EXISTS claude_usage_window ON claude_usage (window_name, id);
CREATE INDEX IF NOT EXISTS claude_usage_read ON claude_usage (read_at);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  alert_id INTEGER,
  reason TEXT NOT NULL,
  note TEXT,
  by_name TEXT NOT NULL,
  item_version INTEGER,
  changes_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_item ON feedback (item_id, created_at);
`

export const openDb = (path = DB_PATH) => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrateItemNames(db)
  db.exec(SCHEMA_SQL)
  migrateCurrencyNeutral(db)
  migrateRunsMode(db)
  migrateRunsItemVersion(db)
  migrateRunsSkipped(db)
  migrateListingEvidence(db)
  migrateListingTuned(db)
  migrateAlertKinds(db)
  migrateVersionSources(db)
  migrateDraftColumns(db)
  return db
}

export const startRun = ({
  db, itemId, trigger, slotAt = null, startedAt, mode = DEFAULT_MODE, itemVersion = null
}) => {
  const statement = db.prepare(`
    INSERT INTO runs (item_id, "trigger", slot_at, mode, started_at, status, item_version)
    VALUES (:itemId, :trigger, :slotAt, :mode, :startedAt, 'running', :itemVersion)`)
  const params = { itemId, trigger, slotAt, mode, startedAt, itemVersion }
  return Number(statement.run(params).lastInsertRowid)
}

export const finishRun = ({
  db, runId, status, finishedAt, error = null, costUsd = null, research = null, decision = null
}) => {
  const statement = db.prepare(`
    UPDATE runs SET status = :status, finished_at = :finishedAt, error = :error,
      cost_usd = :costUsd, research_json = :researchJson, decision_json = :decisionJson
    WHERE id = :runId`)
  statement.run({
    runId,
    status,
    finishedAt,
    error,
    costUsd,
    researchJson: toJson(research),
    decisionJson: toJson(decision)
  })
}

export const failStaleRuns = ({ db, finishedAt }) => {
  const statement = db.prepare(`
    UPDATE runs SET status = 'failed', finished_at = :finishedAt, error = 'interrupted'
    WHERE status = 'running'`)
  return Number(statement.run({ finishedAt }).changes)
}

export const insertListings = ({
  db, runId, itemId, checkedAt, listings, source = DEFAULT_MODE, currency = DEFAULT_CURRENCY
}) => {
  const statement = db.prepare(`
    INSERT INTO listings (run_id, item_id, checked_at, retailer, title, category, price,
      effective_price, was_price, delivery_cost, currency, is_clearance, in_stock, verified, url,
      qualifies, reject_reason, notes, evidence, source, part, tuned)
    VALUES (:runId, :itemId, :checkedAt, :retailer, :title, :category, :price,
      :effectivePrice, :wasPrice, :deliveryCost, :currency, :isClearance, :inStock, :verified,
      :url, :qualifies, :rejectReason, :notes, :evidence, :source, :part, :tuned)`)
  inTransaction(db, () => {
    for (const listing of listings) {
      statement.run({
        runId,
        itemId,
        checkedAt,
        currency,
        retailer: listing.retailer ?? 'unknown',
        title: listing.title ?? null,
        category: listing.category ?? 'reject',
        price: listing.price ?? null,
        effectivePrice: listing.effectivePrice ?? listing.price ?? null,
        wasPrice: listing.wasPrice ?? null,
        deliveryCost: listing.deliveryCost ?? null,
        isClearance: toFlag(listing.isClearance),
        inStock: toFlag(listing.inStock),
        verified: toFlag(listing.verified),
        url: listing.url ?? null,
        qualifies: toFlag(listing.qualifies),
        rejectReason: listing.rejectReason ?? null,
        notes: listing.notes ?? null,
        evidence: listing.evidence ?? null,
        source,
        part: listing.part ?? null,
        tuned: listing.tuned ?? null
      })
    }
  })
  return listings.length
}

export const insertAlert = ({
  db, itemId, runId = null, kind, sentAt, retailer = null, category = null,
  effectivePrice = null, currency = DEFAULT_CURRENCY, url = null, title = null, message = null,
  delivered, error = null
}) => {
  const statement = db.prepare(`
    INSERT INTO alerts (item_id, run_id, kind, sent_at, retailer, category, effective_price,
      currency, url, title, message, delivered, error)
    VALUES (:itemId, :runId, :kind, :sentAt, :retailer, :category, :effectivePrice,
      :currency, :url, :title, :message, :delivered, :error)`)
  const result = statement.run({
    itemId,
    runId,
    kind,
    sentAt,
    retailer,
    category,
    effectivePrice,
    currency,
    url,
    title,
    message,
    delivered: toFlag(delivered),
    error
  })
  return Number(result.lastInsertRowid)
}

export const updateAlertDelivery = ({ db, id, delivered, error = null }) => {
  db.prepare('UPDATE alerts SET delivered = :delivered, error = :error WHERE id = :id')
    .run({ id, delivered: toFlag(delivered), error })
}

export const getAlert = ({ db, id }) => {
  const row = db.prepare('SELECT * FROM alerts WHERE id = :id').get({ id })
  return row ? toAlert(row) : null
}

export const previousDealAlert = ({ db, alert }) => {
  const row = db.prepare(`
    SELECT * FROM alerts
    WHERE item_id = :itemId AND kind = 'deal' AND delivered = 1 AND id < :id
      AND lower(retailer) = lower(:retailer) AND category = :category
    ORDER BY id DESC LIMIT 1`).get({
    itemId: alert.itemId, id: alert.id, retailer: alert.retailer ?? '',
    category: alert.category ?? ''
  })
  return row ? toAlert(row) : null
}

export const lastAlertsFor = ({ db, itemId, kind = 'deal' }) => {
  const rows = db.prepare(`
    SELECT retailer, category, effective_price, sent_at FROM alerts
    WHERE item_id = :itemId AND kind = :kind AND delivered = 1
    ORDER BY sent_at ASC, id ASC`).all({ itemId, kind })
  return new Map(rows.map((row) => [
    dedupeKey({ retailer: row.retailer, category: row.category }),
    { effectivePrice: row.effective_price, sentAt: row.sent_at }
  ]))
}

export const insertFeedback = ({
  db, itemId, alertId = null, reason, note = null, by, itemVersion = null, changes = null, at
}) => {
  const result = db.prepare(`
    INSERT INTO feedback (item_id, alert_id, reason, note, by_name, item_version, changes_json,
      created_at)
    VALUES (:itemId, :alertId, :reason, :note, :by, :itemVersion, :changesJson, :at)`).run({
    itemId, alertId, reason, note, by, itemVersion, changesJson: toJson(changes), at
  })
  return Number(result.lastInsertRowid)
}

export const feedbackFor = ({ db, itemId, limit = 50 }) => db.prepare(`
  SELECT * FROM feedback WHERE item_id = :itemId ORDER BY created_at DESC, id DESC
  LIMIT :limit`).all({ itemId, limit })
  .map(({ changes_json: changesJson, by_name: by, ...row }) => ({
    ...camelize(row), by, changes: fromJson(changesJson)
  }))

export const recentSiteNames = ({ db, item, now = new Date(), days = 7 }) => {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  const knownRetailers = knownRetailersFor(item)
  const rows = db.prepare(`
    SELECT research_json FROM runs
    WHERE item_id = :itemId AND mode = 'research' AND status = 'ok' AND "trigger" != 'dry-run'
      AND started_at >= :since AND research_json IS NOT NULL`).all({ itemId: item.id, since })
  const names = rows.flatMap(({ research_json: json }) =>
    (fromJson(json)?.sources ?? []).map(({ name }) => canonicalRetailer({ name, knownRetailers })))
  return [...new Set(names)]
}

export const lastSuccessAt = ({ db, itemId, mode = DEFAULT_MODE }) => {
  const row = db.prepare(`
    SELECT started_at FROM runs
    WHERE item_id = :itemId AND status = 'ok' AND "trigger" != 'dry-run' AND mode = :mode
    ORDER BY started_at DESC, id DESC LIMIT 1`).get({ itemId, mode })
  return row?.started_at ?? null
}

export const lastFailedRunAt = ({ db, itemId, mode = DEFAULT_MODE }) => {
  const row = db.prepare(`
    SELECT started_at FROM runs
    WHERE item_id = :itemId AND status = 'failed' AND "trigger" != 'dry-run' AND mode = :mode
    ORDER BY started_at DESC, id DESC LIMIT 1`).get({ itemId, mode })
  return row?.started_at ?? null
}

export const lastSkippedAt = ({ db, itemId, mode = DEFAULT_MODE }) => {
  const row = db.prepare(`
    SELECT started_at FROM runs
    WHERE item_id = :itemId AND status = 'skipped' AND mode = :mode
    ORDER BY started_at DESC, id DESC LIMIT 1`).get({ itemId, mode })
  return row?.started_at ?? null
}

export const recordSkippedRun = ({
  db, itemId, trigger, slotAt = null, at, mode = DEFAULT_MODE, itemVersion = null, reason
}) => {
  const runId = startRun({ db, itemId, trigger, slotAt, startedAt: at, mode, itemVersion })
  finishRun({ db, runId, status: 'skipped', finishedAt: at, error: reason })
  return runId
}

export const lastRun = ({ db, itemId }) => {
  const row = db.prepare(`
    SELECT ${RUN_COLUMNS} FROM runs
    WHERE item_id = :itemId AND "trigger" != 'dry-run'
    ORDER BY id DESC LIMIT 1`).get({ itemId })
  return row ? camelize(row) : null
}

export const lastAlert = ({ db, itemId }) => {
  const row = db.prepare(`
    SELECT * FROM alerts WHERE item_id = :itemId AND kind != 'test'
    ORDER BY sent_at DESC, id DESC LIMIT 1`)
    .get({ itemId })
  return row ? toAlert(row) : null
}

export const hasHeartbeatThisMonth = ({ db, itemId, now, tz }) => {
  const rows = db.prepare(`
    SELECT sent_at FROM alerts
    WHERE item_id = :itemId AND kind = 'heartbeat' AND delivered = 1`).all({ itemId })
  const currentMonth = monthKey({ date: now, tz })
  return rows.some((row) => monthKey({ date: new Date(row.sent_at), tz }) === currentMonth)
}

export const historyRows = ({ db, itemId, days = 30, now = new Date() }) => {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const rows = db.prepare(`
    SELECT ${LISTING_COLUMNS} FROM listings l LEFT JOIN runs r ON r.id = l.run_id
    WHERE l.item_id = :itemId AND l.checked_at >= :since
      AND l.category != 'reject' AND l.in_stock = 1 AND l.effective_price IS NOT NULL
    ORDER BY l.checked_at ASC, l.id ASC`).all({ itemId, since })
  return rows.map(toListing)
}

export const dayListings = ({ db, itemId, day, tz = DEFAULT_TZ }) => {
  const dayStart = Date.parse(`${day}T00:00:00Z`)
  const rows = db.prepare(`
    SELECT ${LISTING_COLUMNS} FROM listings l LEFT JOIN runs r ON r.id = l.run_id
    WHERE l.item_id = :itemId AND l.checked_at >= :from AND l.checked_at < :until
    ORDER BY l.checked_at ASC, l.id ASC`).all({
    itemId,
    from: new Date(dayStart - DAY_MS).toISOString(),
    until: new Date(dayStart + 2 * DAY_MS).toISOString()
  })
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  return rows
    .filter((row) => dayFormat.format(new Date(row.checked_at)) === day)
    .map(toListing)
}

export const runListings = ({ db, runId }) => {
  const rows = db.prepare('SELECT * FROM listings WHERE run_id = :runId ORDER BY id ASC')
    .all({ runId })
  return rows.map(toListing)
}

export const recentRuns = ({ db, itemId = null, limit = 20 }) => {
  const rows = db.prepare(`
    SELECT ${RUN_COLUMNS},
      (SELECT COUNT(*) FROM listings l WHERE l.run_id = runs.id) AS listing_count,
      (SELECT COUNT(*) FROM listings l WHERE l.run_id = runs.id AND l.qualifies = 1)
        AS qualified_count
    FROM runs
    WHERE (:itemId IS NULL OR item_id = :itemId)
    ORDER BY id DESC LIMIT :limit`).all({ itemId, limit })
  return rows.map(camelize)
}

export const getRun = ({ db, id }) => {
  const row = db.prepare('SELECT * FROM runs WHERE id = :id').get({ id })
  if (!row) return null
  const { research_json: researchJson, decision_json: decisionJson, ...columns } = row
  return {
    ...camelize(columns),
    research: fromJson(researchJson),
    decision: fromJson(decisionJson)
  }
}

export const recentAlerts = ({ db, itemId = null, limit = 50 }) => {
  const rows = db.prepare(`
    SELECT * FROM alerts
    WHERE (:itemId IS NULL OR item_id = :itemId)
    ORDER BY sent_at DESC, id DESC LIMIT :limit`).all({ itemId, limit })
  return rows.map(toAlert)
}

export const normaliseStoredRetailers = ({ db, items }) => {
  const changes = { listings: 0, alerts: 0 }
  inTransaction(db, () => {
    for (const item of items) {
      const knownRetailers = knownRetailersFor(item)
      const rewrite = (table) =>
        rewriteRetailers({ db, table, itemId: item.id, knownRetailers })
      changes.listings += rewrite('listings')
      changes.alerts += rewrite('alerts')
    }
  })
  return changes
}

export const inTransaction = (db, fn) => {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const rewriteRetailers = ({ db, table, itemId, knownRetailers }) => {
  const names = db.prepare(
    `SELECT DISTINCT retailer FROM ${table} WHERE item_id = :itemId AND retailer IS NOT NULL`
  ).all({ itemId }).map(({ retailer }) => retailer)
  const update = db.prepare(
    `UPDATE ${table} SET retailer = :canonical WHERE item_id = :itemId AND retailer = :retailer`
  )
  return names.reduce((total, retailer) => {
    const canonical = canonicalRetailer({ name: retailer, knownRetailers })
    if (canonical === retailer) return total
    return total + Number(update.run({ itemId, retailer, canonical }).changes)
  }, 0)
}

const DEFAULT_MODE = 'research'
const DEFAULT_TZ = DEFAULT_REGION.timeZone
const DEFAULT_CURRENCY = DEFAULT_REGION.currency
const LEGACY_CURRENCY = 'AUD'
const CURRENCY_NEUTRAL_RENAMES = {
  listings: [
    ['price_aud', 'price'],
    ['effective_price_aud', 'effective_price'],
    ['was_price_aud', 'was_price'],
    ['delivery_aud', 'delivery_cost']
  ],
  alerts: [['effective_price_aud', 'effective_price']]
}

const migrateCurrencyNeutral = (db) => {
  const statements = Object.entries(CURRENCY_NEUTRAL_RENAMES)
    .flatMap(([table, renames]) => currencyNeutralStatements({ db, table, renames }))
  if (statements.length === 0) return
  inTransaction(db, () => statements.forEach((statement) => db.exec(statement)))
}

const currencyNeutralStatements = ({ db, table, renames }) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name)
  const addCurrency = columns.includes('currency')
    ? []
    : [`ALTER TABLE ${table} ADD COLUMN currency TEXT NOT NULL DEFAULT '${LEGACY_CURRENCY}'`]
  return [
    ...renames
      .filter(([from]) => columns.includes(from))
      .map(([from, to]) => `ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`),
    ...addCurrency
  ]
}
const DAY_MS = 86_400_000

const LEGACY_TABLE_NAMES = [
  ['watches', 'items'],
  ['watch_versions', 'item_versions'],
  ['deleted_watches', 'deleted_items']
]
const LEGACY_COLUMN_NAMES = {
  runs: [['watch_id', 'item_id'], ['watch_version', 'item_version']],
  listings: [['watch_id', 'item_id']],
  alerts: [['watch_id', 'item_id']],
  watch_versions: [['watch_id', 'item_id']],
  drafts: [['watch_id', 'item_id']],
  feedback: [['watch_id', 'item_id'], ['watch_version', 'item_version']]
}
const LEGACY_INDEX_NAMES = [
  'runs_watch_started', 'listings_watch_checked', 'alerts_watch_sent', 'feedback_watch'
]

const migrateItemNames = (db) => {
  const statements = itemNameStatements(db)
  if (statements.length === 0) return
  inTransaction(db, () => statements.forEach((statement) => db.exec(statement)))
}

const itemNameStatements = (db) => {
  const tables = schemaNames({ db, type: 'table' })
  const indexes = schemaNames({ db, type: 'index' })
  const columnRenames = Object.entries(LEGACY_COLUMN_NAMES)
    .filter(([table]) => tables.has(table))
    .flatMap(([table, renames]) => renameColumnStatements({ db, table, renames }))
  const tableRenames = LEGACY_TABLE_NAMES
    .filter(([from, to]) => tables.has(from) && !tables.has(to))
    .map(([from, to]) => `ALTER TABLE ${from} RENAME TO ${to}`)
  const indexDrops = LEGACY_INDEX_NAMES
    .filter((name) => indexes.has(name))
    .map((name) => `DROP INDEX ${name}`)
  return [...columnRenames, ...tableRenames, ...indexDrops]
}

const renameColumnStatements = ({ db, table, renames }) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name)
  return renames
    .filter(([from, to]) => columns.includes(from) && !columns.includes(to))
    .map(([from, to]) => `ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`)
}

const schemaNames = ({ db, type }) => new Set(db.prepare(
  'SELECT name FROM sqlite_master WHERE type = :type'
).all({ type }).map(({ name }) => name))

const migrateListingEvidence = (db) => {
  const columns = db.prepare('PRAGMA table_info(listings)').all().map(({ name }) => name)
  const missing = ['evidence', 'source'].filter((name) => !columns.includes(name))
  if (!columns.includes('part')) db.exec('ALTER TABLE listings ADD COLUMN part TEXT')
  if (missing.length === 0) return
  inTransaction(db, () => {
    if (missing.includes('evidence')) db.exec('ALTER TABLE listings ADD COLUMN evidence TEXT')
    if (missing.includes('source')) {
      db.exec(`ALTER TABLE listings ADD COLUMN source TEXT NOT NULL DEFAULT '${DEFAULT_MODE}'`)
      db.exec(`UPDATE listings SET source = COALESCE(
        (SELECT mode FROM runs WHERE runs.id = listings.run_id), '${DEFAULT_MODE}')`)
    }
    if (missing.includes('evidence')) backfillEvidence(db)
  })
}

const backfillEvidence = (db) => {
  const runs = db.prepare(`
    SELECT id, research_json FROM runs WHERE research_json IS NOT NULL
      AND id IN (SELECT DISTINCT run_id FROM listings)`).all()
  const update = db.prepare(`
    UPDATE listings SET evidence = :evidence
    WHERE run_id = :runId AND retailer = :retailer AND title IS :title AND url IS :url
      AND evidence IS NULL`)
  for (const run of runs) {
    const researched = fromJson(run.research_json)?.listings ?? []
    for (const listing of researched.filter(({ evidence }) => evidence)) {
      update.run({
        evidence: listing.evidence,
        runId: run.id,
        retailer: listing.retailer ?? 'unknown',
        title: listing.title ?? null,
        url: listing.url ?? null
      })
    }
  }
}

const migrateListingTuned = (db) => {
  const columns = db.prepare('PRAGMA table_info(listings)').all().map(({ name }) => name)
  if (!columns.includes('tuned')) db.exec('ALTER TABLE listings ADD COLUMN tuned TEXT')
}

const migrateAlertKinds = (db) => {
  const { sql } = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'alerts'`).get()
  if (sql.includes("'check'")) return
  rebuildTable({ db, table: 'alerts', indexes: [
    'CREATE INDEX IF NOT EXISTS alerts_item_sent ON alerts (item_id, sent_at)'
  ] })
}

const rebuildTable = ({ db, table, indexes }) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => `"${name}"`)
  const createNext = SCHEMA_SQL
    .slice(SCHEMA_SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`))
    .split(');')[0]
    .replace(`CREATE TABLE IF NOT EXISTS ${table} (`, `CREATE TABLE ${table}_next (`)
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    inTransaction(db, () => {
      db.exec(`${createNext});`)
      db.exec(`INSERT INTO ${table}_next (${columns.join(', ')})
        SELECT ${columns.join(', ')} FROM ${table}`)
      db.exec(`DROP TABLE ${table}`)
      db.exec(`ALTER TABLE ${table}_next RENAME TO ${table}`)
      indexes.forEach((index) => db.exec(index))
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

const migrateDraftColumns = (db) => {
  const columns = db.prepare('PRAGMA table_info(drafts)').all().map(({ name }) => name)
  Object.entries(DRAFT_EXTRA_COLUMNS)
    .filter(([name]) => !columns.includes(name))
    .forEach(([name, type]) => db.exec(`ALTER TABLE drafts ADD COLUMN ${name} ${type}`))
}

const migrateVersionSources = (db) => {
  const { sql } = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'item_versions'`).get()
  if (sql.includes("'tune'")) return
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    inTransaction(db, () => {
      db.exec(`
        CREATE TABLE item_versions_next (
          item_id TEXT NOT NULL REFERENCES items (id),
          version INTEGER NOT NULL,
          config_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          note TEXT,
          source TEXT NOT NULL CHECK (source IN (${VERSION_SOURCES})),
          PRIMARY KEY (item_id, version)
        )`)
      db.exec(`INSERT INTO item_versions_next (item_id, version, config_json, created_at, note,
        source) SELECT item_id, version, config_json, created_at, note, source
        FROM item_versions`)
      db.exec('DROP TABLE item_versions')
      db.exec('ALTER TABLE item_versions_next RENAME TO item_versions')
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

const migrateRunsItemVersion = (db) => {
  const columns = db.prepare('PRAGMA table_info(runs)').all()
  if (columns.some(({ name }) => name === 'item_version')) return
  inTransaction(db, () => {
    db.exec('ALTER TABLE runs ADD COLUMN item_version INTEGER')
    db.exec('UPDATE runs SET item_version = 1')
  })
}

const migrateRunsSkipped = (db) => {
  const { sql } = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'`).get()
  if (sql.includes("'skipped'")) return
  const columns = db.prepare('PRAGMA table_info(runs)').all().map(({ name }) => `"${name}"`)
  const createNext = SCHEMA_SQL
    .slice(SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS runs ('))
    .split(');')[0]
    .replace('CREATE TABLE IF NOT EXISTS runs (', 'CREATE TABLE runs_next (')
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    inTransaction(db, () => {
      db.exec(`${createNext});`)
      db.exec(`INSERT INTO runs_next (${columns.join(', ')})
        SELECT ${columns.join(', ')} FROM runs`)
      db.exec('DROP TABLE runs')
      db.exec('ALTER TABLE runs_next RENAME TO runs')
      db.exec('CREATE INDEX IF NOT EXISTS runs_item_started ON runs (item_id, started_at)')
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

const migrateRunsMode = (db) => {
  const columns = db.prepare('PRAGMA table_info(runs)').all()
  if (columns.some(({ name }) => name === 'mode')) return
  db.exec(`ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT '${DEFAULT_MODE}'`)
}

const RUN_COLUMNS = `id, item_id, "trigger", slot_at, mode, started_at, finished_at, status,
  error, cost_usd, item_version`

const LISTING_COLUMNS = 'l.*, r.item_version AS item_version'

const monthKey = ({ date, tz }) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit'
  })
  const parts = formatter.formatToParts(date)
  const part = (type) => parts.find((entry) => entry.type === type).value
  return `${part('year')}-${part('month')}`
}

const toListing = (row) => ({
  ...camelize(row),
  isClearance: row.is_clearance === 1,
  inStock: row.in_stock === 1,
  verified: row.verified === 1,
  qualifies: row.qualifies === 1
})

const toAlert = (row) => ({ ...camelize(row), delivered: row.delivered === 1 })

const camelize = (row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [toCamel(key), value])
)

const toCamel = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

const toFlag = (value) => (value ? 1 : 0)

const toJson = (value) => (value === null || value === undefined ? null : JSON.stringify(value))

const fromJson = parseStoredJson
