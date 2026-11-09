import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feedbackFor, finishRun, openDb, startRun } from '../src/db.js'
import { createApp } from '../src/server.js'
import { createItem } from '../src/item-store.js'

const NOW = new Date('2027-02-10T00:00:00.000Z')
const DIRECT_URL = 'https://www.myer.com.au/p/springfree-medium-oval'

const config = (overrides = {}) => ({
  id: 'tramp',
  name: 'Springfree medium oval',
  product: 'A Springfree O77',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'tramp-topic' },
  categories: [
    { id: 'bundle', description: 'O77 bundle' },
    { id: 'base', description: 'O77 alone' }
  ],
  rules: { bundle: { maxPrice: 2000 }, base: { maxPrice: 1500 } },
  sources: { sites: [{ name: 'Myer' }, { name: 'Bing Lee' }], searches: ['springfree o77'] },
  direct: [{ retailer: 'Myer', url: DIRECT_URL, category: 'base', parser: 'jsonld' }],
  directSchedules: [{ cron: '30 7 * * *', tz: 'Australia/Sydney' }],
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: false },
  ...overrides
})

const addRun = ({ db, mode, daysAgo, sources, listings = [] }) => {
  const startedAt = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()
  const runId = startRun({ db, itemId: 'tramp', trigger: 'tick', startedAt, mode,
    itemVersion: 1 })
  finishRun({
    db, runId, status: 'ok', finishedAt: startedAt,
    research: { checkedAt: startedAt, sources, listings }, decision: { qualified: [] }
  })
}

const seed = (db) => {
  createItem({ db, config: config(), now: NOW })
  const directDays = [3, 2, 1]
  const researchDays = [6, 4, 2]
  directDays.forEach((daysAgo) => addRun({
    db, mode: 'direct', daysAgo,
    sources: [{ name: 'Myer direct springfree-medium-oval', status: 'error', note: 'HTTP 503' }]
  }))
  researchDays.forEach((daysAgo) => addRun({
    db, mode: 'research', daysAgo,
    sources: [
      { name: 'Myer', status: 'ok', note: 'Listed' },
      { name: 'Bing Lee', status: 'blocked', note: 'Access denied' }
    ]
  }))
}

const withServer = async (fn) => {
  const db = openDb(':memory:')
  seed(db)
  const app = createApp({ db, now: () => NOW, distDir: '/nonexistent' })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const send = async ({ path, body = {} }) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
  }
  const get = async (path) => {
    const response = await fetch(`${base}${path}`)
    return { status: response.status, body: await response.json() }
  }
  try {
    await fn({ db, send, get })
  } finally {
    server.close()
  }
}

const D1 = `D1:direct:${DIRECT_URL}`

test('GET suggestions returns rule suggestions with the exact tuning change', async () => {
  await withServer(async ({ get }) => {
    const { status, body } = await get('/api/items/tramp/suggestions')
    assert.equal(status, 200)
    assert.equal(body.version, 1)
    const ids = body.suggestions.map(({ id }) => id).sort()
    assert.deepEqual(ids, [D1, 'S1:site:Bing Lee'])
    const off = body.suggestions.find(({ id }) => id === D1)
    assert.deepEqual(off.change, { kind: 'disable-direct', url: DIRECT_URL })
    assert.equal(off.evidence.times, undefined)
    assert.equal((await get('/api/items/nope/suggestions')).status, 404)
  })
})

test('dismiss hides a suggestion, restore brings it back, and both are logged', async () => {
  await withServer(async ({ db, send, get }) => {
    const missingBy = await send({
      path: '/api/items/tramp/suggestions/dismiss', body: { suggestionId: D1 }
    })
    assert.equal(missingBy.status, 400)
    const unknown = await send({
      path: '/api/items/tramp/suggestions/dismiss', body: { suggestionId: 'S9:x', by: 'J' }
    })
    assert.equal(unknown.status, 404)
    const dismissed = await send({
      path: '/api/items/tramp/suggestions/dismiss',
      body: { suggestionId: D1, by: 'Alex', permanent: true }
    })
    assert.equal(dismissed.status, 201)
    const after = (await get('/api/items/tramp/suggestions')).body
    assert.equal(after.suggestions.some(({ id }) => id === D1), false)
    assert.equal(after.dismissed[0].id, D1)
    assert.deepEqual(after.dismissed[0].dismissal.permanent, true)
    const [row] = feedbackFor({ db, itemId: 'tramp' })
    assert.equal(row.reason, 'suggestion-dismissed')
    assert.deepEqual(row.changes.kinds, ['direct-error'])
    const restored = await send({
      path: '/api/items/tramp/suggestions/restore', body: { suggestionId: D1, by: 'Alex' }
    })
    assert.equal(restored.status, 201)
    const again = await send({
      path: '/api/items/tramp/suggestions/restore', body: { suggestionId: D1, by: 'Alex' }
    })
    assert.equal(again.status, 404)
    const back = (await get('/api/items/tramp/suggestions')).body
    assert.ok(back.suggestions.some(({ id }) => id === D1))
  })
})

test('accepting through the tuning route applies the change and clears it', async () => {
  await withServer(async ({ send, get }) => {
    const { body } = await get('/api/items/tramp/suggestions')
    const off = body.suggestions.find(({ id }) => id === D1)
    const saved = await send({
      path: '/api/items/tramp/tuning',
      body: { baseVersion: body.version, changes: [off.change], by: 'Alex', reason: off.reason }
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.config.tuning.direct[DIRECT_URL].state, 'off')
    const next = (await get('/api/items/tramp/suggestions')).body
    assert.equal(next.suggestions.some(({ id }) => id === D1), false)
  })
})

test('GET site-stats returns per-source rows for 30 or 90 days', async () => {
  await withServer(async ({ get }) => {
    const { body } = await get('/api/items/tramp/site-stats?days=90')
    assert.equal(body.days, 90)
    const bing = body.sites.find(({ name }) => name === 'Bing Lee')
    assert.deepEqual(bing.statuses, { ok: 0, blocked: 3, error: 0, not_found: 0 })
    assert.equal(bing.checkTimes, undefined)
    const direct = body.sites.find(({ kind }) => kind === 'direct')
    assert.equal(direct.url, DIRECT_URL)
    assert.equal(direct.statuses.error, 3)
    assert.equal((await get('/api/items/tramp/site-stats?days=7')).body.days, 30)
    assert.deepEqual(body.categories.map(({ id }) => id), ['bundle', 'base'])
  })
})

test('GET failing-sites lists nothing with one item', async () => {
  await withServer(async ({ get }) => {
    const { status, body } = await get('/api/tuning/failing-sites')
    assert.equal(status, 200)
    assert.deepEqual(body, [])
  })
})
