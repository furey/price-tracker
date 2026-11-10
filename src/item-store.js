import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ITEMS_DIR } from './config.js'
import { inTransaction } from './db.js'
import { parseStoredJson, withCurrentKeys } from './legacy-keys.js'
import { DEFAULT_REGION } from './regions/index.js'
import { topicName } from './topics.js'
import { windowBounds } from './schedule.js'
import { validateItem } from './item-validate.js'

export const ITEM_STATUSES = ['active', 'paused', 'archived']
export const PAUSE_TZ = DEFAULT_REGION.timeZone
export const MAX_NOTE_LENGTH = 500

export class ItemError extends Error {
  constructor({ code, message, errors = [], details = {} }) {
    super(message)
    this.code = code
    this.errors = errors
    this.details = details
  }
}

export const seedItems = ({ db, dir = ITEMS_DIR, now = new Date(), log = () => {} }) => {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => seedFile({ db, dir, file, now, log }))
}

export const pinSeeds = ({ db, dir = ITEMS_DIR }) => {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .filter((id) => db.prepare('SELECT 1 FROM items WHERE id = :id').get({ id }))
    .map((id) => {
      pinSeed({ db, id, dir })
      return id
    })
}

export const itemRecords = ({ db, now = new Date() }) => {
  resumeExpiredPauses({ db, now })
  return db.prepare(`${RECORD_SELECT} ORDER BY w.id`).all().map(toRecord)
}

export const runnableItems = ({ db, now = new Date() }) => itemRecords({ db, now })
  .filter((record) => record.status === 'active')
  .map((record) => ({ item: record.config, version: record.version }))

export const findItem = ({ db, id, now = new Date() }) => {
  resumeExpiredPauses({ db, now })
  const row = db.prepare(`${RECORD_SELECT} WHERE w.id = :id`).get({ id })
  return row ? toRecord(row) : null
}

export const rotateTopic = ({ db, id, dir = ITEMS_DIR, now = new Date() }) => {
  const record = requireItem({ db, id, now })
  const topic = topicName({ slug: record.id, hex: randomBytes(16).toString('hex') })
  const config = { ...record.config, ntfy: { ...record.config.ntfy, topic } }
  const saved = saveItemConfig({
    db, id, baseVersion: record.version, config, note: 'Rotated the ntfy topic', now
  })
  pinSeed({ db, id, dir })
  return saved
}

export const requireItem = ({ db, id, now = new Date() }) => {
  const record = findItem({ db, id, now })
  if (record) return record
  const known = db.prepare('SELECT id FROM items ORDER BY id').all().map((row) => row.id)
  throw new ItemError({
    code: 'not-found',
    message: `Unknown item "${id}". Known: ${known.join(', ') || 'none'}`
  })
}

export const createItem = ({
  db, config, origin = 'app', source = 'edit', note = null, seedHash = null, status = 'active',
  now = new Date()
}) => {
  const cleaned = withCurrentKeys(withoutEnabled(config))
  const errors = validateItem(cleaned)
  if (errors.length > 0) throw invalid(errors)
  if (findItem({ db, id: cleaned.id, now })) {
    throw new ItemError({ code: 'conflict', message: `Item "${cleaned.id}" already exists` })
  }
  const at = now.toISOString()
  inTransaction(db, () => {
    db.prepare('DELETE FROM deleted_items WHERE id = :id').run({ id: cleaned.id })
    db.prepare(`
      INSERT INTO items (id, status, paused_until, current_version, origin, seed_hash,
        created_at, updated_at)
      VALUES (:id, :status, NULL, 1, :origin, :seedHash, :at, :at)`)
      .run({ id: cleaned.id, status, origin, seedHash, at })
    insertVersion({ db, id: cleaned.id, version: 1, config: cleaned, note, source, at })
  })
  return findItem({ db, id: cleaned.id, now })
}

export const saveItemConfig = ({
  db, id, baseVersion, config, note = null, source = 'edit', now = new Date(), transaction = true
}) => {
  const record = requireItem({ db, id, now })
  if (baseVersion !== record.version) {
    throw new ItemError({
      code: 'conflict',
      message: `This item changed while you were editing: version ${record.version} is now `
        + `current and you started from version ${baseVersion}. Reload to see it.`,
      details: { currentVersion: record.version }
    })
  }
  const cleaned = withCurrentKeys(withoutEnabled(config))
  if (cleaned?.id !== id) throw invalid([`id: cannot change (expected "${id}")`])
  const errors = validateItem(cleaned)
  if (errors.length > 0) throw invalid(errors)
  if (sameConfig(cleaned, record.config)) throw invalid([], 'No changes to save')
  const version = record.version + 1
  const at = now.toISOString()
  const write = () => {
    insertVersion({ db, id, version, config: cleaned, note: cleanNote(note), source, at })
    db.prepare(`UPDATE items SET current_version = :version, updated_at = :at WHERE id = :id`)
      .run({ id, version, at })
  }
  if (transaction) inTransaction(db, write)
  else write()
  return findItem({ db, id, now })
}

export const itemVersions = ({ db, id }) => db.prepare(`
  SELECT version, created_at, note, source FROM item_versions
  WHERE item_id = :id ORDER BY version DESC`).all({ id })
  .map(({ version, created_at: createdAt, note, source }) => ({ version, createdAt, note, source }))

export const itemVersionConfig = ({ db, id, version }) => {
  const row = db.prepare(`
    SELECT config_json FROM item_versions WHERE item_id = :id AND version = :version`)
    .get({ id, version })
  return parseStoredJson(row?.config_json)
}

export const rulesByVersion = ({ db, itemId }) => new Map(
  db.prepare('SELECT version, config_json FROM item_versions WHERE item_id = :itemId')
    .all({ itemId })
    .map(({ version, config_json: json }) => [version, parseStoredJson(json).rules ?? {}])
)

export const pauseItem = ({ db, id, until = null, now = new Date(), tz = PAUSE_TZ }) => {
  const record = requireItem({ db, id, now })
  if (record.status === 'archived') throw archivedError(id)
  const pausedUntil = parsePauseUntil({ until, now, tz })
  setStatus({ db, id, status: 'paused', pausedUntil, now })
  return findItem({ db, id, now })
}

export const resumeItem = ({ db, id, now = new Date() }) => {
  const record = requireItem({ db, id, now })
  if (record.status === 'archived') throw archivedError(id)
  setStatus({ db, id, status: 'active', pausedUntil: null, now })
  return findItem({ db, id, now })
}

export const archiveItem = ({ db, id, now = new Date() }) => {
  requireItem({ db, id, now })
  setStatus({ db, id, status: 'archived', pausedUntil: null, now })
  return findItem({ db, id, now })
}

export const restoreItem = ({ db, id, now = new Date() }) => {
  const record = requireItem({ db, id, now })
  if (record.status !== 'archived') {
    throw new ItemError({ code: 'state', message: `Item "${id}" is not archived` })
  }
  setStatus({ db, id, status: 'active', pausedUntil: null, now })
  return findItem({ db, id, now })
}

export const deleteItem = ({ db, id, confirm, now = new Date() }) => {
  const record = requireItem({ db, id, now })
  if (record.status !== 'archived') {
    throw new ItemError({
      code: 'state', message: `Archive item "${id}" before deleting it`
    })
  }
  if (confirm !== id) throw invalid([`confirm: type the item id "${id}" to delete it`])
  const params = { id }
  return inTransaction(db, () => {
    db.prepare('DELETE FROM screenshots WHERE item_id = :id').run(params)
    const removed = {
      alerts: changes(db.prepare('DELETE FROM alerts WHERE item_id = :id').run(params)),
      listings: changes(db.prepare('DELETE FROM listings WHERE item_id = :id').run(params)),
      runs: changes(db.prepare('DELETE FROM runs WHERE item_id = :id').run(params)),
      versions: changes(db.prepare('DELETE FROM item_versions WHERE item_id = :id').run(params))
    }
    db.prepare('DELETE FROM feedback WHERE item_id = :id').run(params)
    db.prepare('DELETE FROM items WHERE id = :id').run(params)
    db.prepare(`
      INSERT INTO deleted_items (id, deleted_at) VALUES (:id, :at)
      ON CONFLICT (id) DO UPDATE SET deleted_at = :at`).run({ id, at: now.toISOString() })
    return removed
  })
}

export const resumeExpiredPauses = ({ db, now = new Date() }) => {
  const at = now.toISOString()
  return changes(db.prepare(`
    UPDATE items SET status = 'active', paused_until = NULL, updated_at = :at
    WHERE status = 'paused' AND paused_until IS NOT NULL AND paused_until <= :at`).run({ at }))
}

export const exportConfig = (config) => `${JSON.stringify(withoutEnabled(config), null, 2)}\n`

const seedFile = ({ db, dir, file, now, log }) => {
  const id = file.replace(/\.json$/, '')
  const parsed = readSeed({ dir, file })
  if (parsed.error) {
    log(`seed ${file} skipped: ${parsed.error}`)
    return { id, file, action: 'invalid' }
  }
  const errors = validateItem(parsed.config, id)
  if (errors.length > 0) {
    log(`seed ${file} skipped: ${errors.join('; ')}`)
    return { id, file, action: 'invalid' }
  }
  const action = applySeed({ db, id, file, raw: parsed.config, now })
  if (action === 'created') log(`seed ${file} imported as item "${id}" version 1`)
  if (action === 'updated') log(`seed ${file} changed: imported as a new version of "${id}"`)
  if (action === 'conflict') {
    log(`WARNING seed ${file} changed in git, but item "${id}" was edited in the app. `
      + 'Kept the app version. Export it with "cli.js export" to bring git up to date.')
  }
  return { id, file, action }
}

const applySeed = ({ db, id, file, raw, now }) => {
  const config = withoutEnabled(raw)
  const hash = hashConfig(config)
  if (isTombstoned({ db, id })) return 'deleted'
  const record = findItem({ db, id, now })
  if (!record) {
    createItem({
      db,
      config,
      origin: 'seed',
      source: 'seed',
      note: `Imported from items/${file}`,
      seedHash: hash,
      status: raw.enabled === false ? 'paused' : 'active',
      now
    })
    return 'created'
  }
  if (record.seedHash === hash) return 'unchanged'
  if (sameConfig(config, record.config)) {
    setSeedHash({ db, id, hash })
    return 'unchanged'
  }
  if (wasEditedInApp({ db, id })) return 'conflict'
  saveItemConfig({
    db, id, baseVersion: record.version, config, note: `Updated from items/${file}`,
    source: 'seed', now
  })
  setSeedHash({ db, id, hash })
  return 'updated'
}

const readSeed = ({ dir, file }) => {
  try {
    return { config: withCurrentKeys(JSON.parse(readFileSync(path.join(dir, file), 'utf8'))) }
  } catch (error) {
    return { error: `cannot parse: ${error.message}` }
  }
}

const parsePauseUntil = ({ until, now, tz }) => {
  if (until === null || until === undefined || until === '') return null
  const instant = typeof until === 'string' ? toInstant({ value: until, tz }) : null
  if (!instant) throw invalid(['until: expected a YYYY-MM-DD date'])
  if (instant <= now) throw invalid(['until: must be in the future'])
  return instant.toISOString()
}

const toInstant = ({ value, tz }) => {
  const date = DATE_ONLY.test(value)
    ? windowBounds({ from: value, tz }).from
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const setStatus = ({ db, id, status, pausedUntil, now }) => {
  db.prepare(`
    UPDATE items SET status = :status, paused_until = :pausedUntil, updated_at = :at
    WHERE id = :id`).run({ id, status, pausedUntil, at: now.toISOString() })
}

const pinSeed = ({ db, id, dir }) => {
  const file = `${id}.json`
  if (!existsSync(path.join(dir, file))) return
  const parsed = readSeed({ dir, file })
  if (!parsed.error) setSeedHash({ db, id, hash: hashConfig(withoutEnabled(parsed.config)) })
}

const setSeedHash = ({ db, id, hash }) => {
  db.prepare('UPDATE items SET seed_hash = :hash WHERE id = :id').run({ id, hash })
}

const insertVersion = ({ db, id, version, config, note, source, at }) => {
  db.prepare(`
    INSERT INTO item_versions (item_id, version, config_json, created_at, note, source)
    VALUES (:id, :version, :json, :at, :note, :source)`)
    .run({ id, version, json: JSON.stringify(config), at, note, source })
}

const isTombstoned = ({ db, id }) =>
  Boolean(db.prepare('SELECT 1 FROM deleted_items WHERE id = :id').get({ id }))

const wasEditedInApp = ({ db, id }) => Boolean(db.prepare(`
  SELECT 1 FROM item_versions WHERE item_id = :id AND source != 'seed' LIMIT 1`).get({ id }))

const RECORD_SELECT = `
  SELECT w.*, v.config_json FROM items w
  JOIN item_versions v ON v.item_id = w.id AND v.version = w.current_version`

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const toRecord = (row) => ({
  id: row.id,
  status: row.status,
  pausedUntil: row.paused_until,
  version: row.current_version,
  origin: row.origin,
  seedHash: row.seed_hash,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  config: parseStoredJson(row.config_json)
})

const archivedError = (id) => new ItemError({
  code: 'state', message: `Item "${id}" is archived. Restore it first.`
})

const invalid = (errors, message = `Invalid item: ${errors.join('; ')}`) =>
  new ItemError({ code: 'invalid', message, errors })

const cleanNote = (note) => {
  const trimmed = typeof note === 'string' ? note.trim() : ''
  return trimmed ? trimmed.slice(0, MAX_NOTE_LENGTH) : null
}

const withoutEnabled = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const { enabled, ...rest } = config
  return rest
}

const sameConfig = (a, b) => canonicalJson(a) === canonicalJson(b)

const hashConfig = (config) => createHash('sha256').update(canonicalJson(config)).digest('hex')

const canonicalJson = (value) => JSON.stringify(sortKeys(value))

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
}

const changes = (result) => Number(result.changes)
