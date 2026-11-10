import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { finishRun, openDb, startRun } from '../src/db.js'
import { createItem, deleteItem } from '../src/item-store.js'
import { createApp } from '../src/server.js'
import { detectImageType, screenshotsToPrune } from '../src/screenshots.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')
const MB = 1024 * 1024

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)
])

const CONFIG = {
  id: 'demo',
  name: 'Demo',
  product: 'A demo product',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'demo-topic' },
  categories: [{ id: 'a', description: 'Category A' }],
  rules: { a: { maxPrice: 1100 } },
  sources: { sites: [{ name: 'Shop' }], searches: ['demo'] }
}

test('detectImageType reads PNG, JPEG, and WebP magic bytes', () => {
  assert.equal(detectImageType(PNG).contentType, 'image/png')
  assert.equal(detectImageType(JPEG).ext, 'jpg')
  assert.equal(detectImageType(WEBP).contentType, 'image/webp')
  assert.equal(detectImageType(Buffer.from('GIF89a-not-allowed')), null)
  assert.equal(detectImageType(Buffer.from('RIFF....WAVEfmt ')), null)
  assert.equal(detectImageType(Buffer.alloc(4)), null)
})

test('screenshotsToPrune picks the oldest until the total fits the cap', () => {
  const rows = [
    { id: 3, bytes: 4, createdAt: '2026-11-03T00:00:00Z' },
    { id: 1, bytes: 5, createdAt: '2026-11-01T00:00:00Z' },
    { id: 2, bytes: 3, createdAt: '2026-11-01T00:00:00Z' }
  ]
  assert.deepEqual(screenshotsToPrune({ rows, capBytes: 12 }), [])
  assert.deepEqual(screenshotsToPrune({ rows, capBytes: 7 }), [1])
  assert.deepEqual(screenshotsToPrune({ rows, capBytes: 4 }), [1, 2])
  assert.deepEqual(screenshotsToPrune({ rows, capBytes: 0 }), [1, 2, 3])
})

test('uploads are stored, listed, served with safe headers, and type checked', async () => {
  await withServer(async ({ db, upload, base, dir }) => {
    const runId = manualRun(db)
    const saved = await upload({ runId, bytes: PNG, type: 'image/png' })
    assert.equal(saved.status, 201)
    assert.equal(saved.body.bytes, PNG.length)
    assert.ok(existsSync(join(dir, String(runId), `${saved.body.id}.png`)))
    const served = await fetch(`${base}/api/screenshots/${saved.body.id}`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(served.headers.get('content-security-policy'), "default-src 'none'")
    assert.equal(served.headers.get('cache-control'), 'private, max-age=86400')
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG)
    const run = await (await fetch(`${base}/api/runs/${runId}`)).json()
    assert.deepEqual(run.screenshots.map(({ id }) => id), [saved.body.id])
    const [listed] = await (await fetch(`${base}/api/items/demo/runs`)).json()
    assert.equal(listed.screenshotCount, 1)
    assert.equal((await upload({ runId, bytes: JPEG, type: 'image/png' })).status, 415)
    assert.equal((await upload({ runId, bytes: Buffer.from('GIF89a......'), type: 'image/gif' }))
      .status, 415)
    assert.equal((await upload({ runId: 999, bytes: PNG, type: 'image/png' })).status, 404)
    assert.equal((await fetch(`${base}/api/screenshots/999`)).status, 404)
  })
})

test('only manual runs take screenshots, and at most 20 each', async () => {
  await withServer(async ({ db, upload }) => {
    const researchRun = startRun({ db, itemId: 'demo', trigger: 'tick', startedAt: iso(0) })
    assert.equal((await upload({ runId: researchRun, bytes: PNG, type: 'image/png' })).status, 409)
    const runId = manualRun(db)
    for (let count = 0; count < 20; count += 1) {
      assert.equal((await upload({ runId, bytes: WEBP, type: 'image/webp' })).status, 201)
    }
    assert.equal((await upload({ runId, bytes: WEBP, type: 'image/webp' })).status, 409)
  })
})

test('an upload over the cap deletes the oldest screenshots and their files', async () => {
  await withServer(async ({ db, upload, dir }) => {
    const runId = manualRun(db)
    const oldIds = [1, 2].map((day) => seedShot({ db, dir, runId, bytes: 5 * MB, day }))
    const saved = await upload({ runId, bytes: JPEG, type: 'image/jpeg' })
    assert.equal(saved.status, 201)
    assert.deepEqual(saved.body.pruned, [oldIds[0]])
    assert.ok(!existsSync(join(dir, String(runId), `${oldIds[0]}.png`)))
    assert.ok(existsSync(join(dir, String(runId), `${oldIds[1]}.png`)))
    const left = db.prepare('SELECT id FROM screenshots ORDER BY id').all().map(({ id }) => id)
    assert.deepEqual(left, [oldIds[1], saved.body.id])
  }, { env: { SCREENSHOT_CAP_MB: '10' } })
})

test('deleting an item removes its screenshot rows and files', async () => {
  await withServer(async ({ db, upload, dir, base }) => {
    const runId = manualRun(db)
    await upload({ runId, bytes: PNG, type: 'image/png' })
    const archive = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
    await fetch(`${base}/api/items/demo/archive`, archive)
    const response = await fetch(`${base}/api/items/demo`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'demo' })
    })
    assert.equal(response.status, 200)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM screenshots').get().count, 0)
    assert.ok(!existsSync(join(dir, String(runId))))
  })
})

test('deleteItem clears screenshot rows so the run rows can go', () => {
  const db = openDb(':memory:')
  createItem({ db, config: CONFIG, now: NOW })
  const runId = manualRun(db)
  db.prepare(`INSERT INTO screenshots (run_id, item_id, file, content_type, bytes, created_at)
    VALUES (:runId, 'demo', 'x.png', 'image/png', 1, :at)`).run({ runId, at: iso(0) })
  db.prepare("UPDATE items SET status = 'archived' WHERE id = 'demo'").run()
  deleteItem({ db, id: 'demo', confirm: 'demo', now: NOW })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM screenshots').get().count, 0)
})

const withServer = async (fn, { env = {} } = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'price-tracker-shots-'))
  const db = openDb(':memory:')
  createItem({ db, config: CONFIG, now: NOW })
  const app = createApp({
    db, now: () => NOW, env, distDir: '/nonexistent', screenshotDir: dir,
    lockPath: join(dir, 'tick.lock')
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const upload = async ({ runId, bytes, type }) => {
    const response = await fetch(`${base}/api/runs/${runId}/screenshots`, {
      method: 'POST', headers: { 'content-type': type }, body: bytes
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    await fn({ db, upload, base, dir })
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}

const manualRun = (db) => {
  const runId = startRun({
    db, itemId: 'demo', trigger: 'manual', startedAt: iso(0), mode: 'manual'
  })
  finishRun({ db, runId, status: 'ok', finishedAt: iso(0) })
  return runId
}

const seedShot = ({ db, dir, runId, bytes, day }) => {
  const id = Number(db.prepare(`
    INSERT INTO screenshots (run_id, item_id, file, content_type, bytes, created_at)
    VALUES (:runId, 'demo', '', 'image/png', :bytes, :at)`)
    .run({ runId, bytes, at: `2026-10-0${day}T00:00:00.000Z` }).lastInsertRowid)
  const file = `${runId}/${id}.png`
  mkdirSync(join(dir, String(runId)), { recursive: true })
  writeFileSync(join(dir, file), PNG)
  db.prepare('UPDATE screenshots SET file = :file WHERE id = :id').run({ id, file })
  return id
}

const iso = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString()
