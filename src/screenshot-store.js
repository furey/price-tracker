import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STATE_DIR } from './config.js'
import { inTransaction } from './db.js'
import { screenshotsToPrune } from './screenshots.js'

export const SCREENSHOT_DIR = join(STATE_DIR, 'screenshots')

export const saveScreenshot = ({ db, dir, run, bytes, kind, now }) => {
  const id = Number(db.prepare(`
    INSERT INTO screenshots (run_id, item_id, file, content_type, bytes, created_at)
    VALUES (:runId, :itemId, '', :contentType, :bytes, :createdAt)`).run({
    runId: run.id,
    itemId: run.itemId,
    contentType: kind.contentType,
    bytes: bytes.length,
    createdAt: now.toISOString()
  }).lastInsertRowid)
  const file = `${run.id}/${id}.${kind.ext}`
  try {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), bytes)
  } catch (error) {
    db.prepare('DELETE FROM screenshots WHERE id = :id').run({ id })
    throw error
  }
  db.prepare('UPDATE screenshots SET file = :file WHERE id = :id').run({ id, file })
  return { id, bytes: bytes.length, createdAt: now.toISOString() }
}

export const pruneScreenshots = ({ db, dir, capBytes }) => {
  const rows = db.prepare('SELECT id, bytes, created_at AS createdAt FROM screenshots').all()
  const ids = screenshotsToPrune({ rows, capBytes })
  if (ids.length === 0) return []
  const files = ids.map((id) => getScreenshot({ db, id }).file)
  const remove = db.prepare('DELETE FROM screenshots WHERE id = :id')
  inTransaction(db, () => ids.forEach((id) => remove.run({ id })))
  files.forEach((file) => removeFile(join(dir, file)))
  return ids
}

export const getScreenshot = ({ db, id }) => {
  const row = db.prepare('SELECT * FROM screenshots WHERE id = :id').get({ id })
  if (!row) return null
  return { id: row.id, runId: row.run_id, file: row.file, contentType: row.content_type }
}

export const screenshotCount = ({ db, runId }) =>
  Number(db.prepare('SELECT COUNT(*) AS count FROM screenshots WHERE run_id = :runId')
    .get({ runId }).count)

export const screenshotsByRun = ({ db, runIds }) => {
  const byRun = new Map(runIds.map((runId) => [runId, []]))
  if (runIds.length === 0) return byRun
  const rows = db.prepare(`
    SELECT id, run_id AS runId, bytes, created_at AS createdAt FROM screenshots
    WHERE run_id IN (SELECT value FROM json_each(:runIds)) ORDER BY id ASC`)
    .all({ runIds: JSON.stringify(runIds) })
  rows.forEach(({ runId, ...shot }) => byRun.get(runId)?.push(shot))
  return byRun
}

export const screenshotRunsForItem = ({ db, itemId }) => db.prepare(
  'SELECT DISTINCT run_id AS runId FROM screenshots WHERE item_id = :itemId'
).all({ itemId }).map(({ runId }) => runId)

export const removeRunFolders = ({ dir, runIds }) =>
  runIds.forEach((runId) => rmSync(join(dir, String(runId)), { recursive: true, force: true }))

const removeFile = (path) => rmSync(path, { force: true })
