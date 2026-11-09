import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOT_CHECK_SEEN_REASON, botCheckFlags, botCheckOf, isBotCheck, seenRecord
} from '../src/bot-checks.js'
import { feedbackFor, finishRun, openDb, startRun } from '../src/db.js'
import { parseJsonLd, parseShopify } from '../src/direct.js'
import { createApp } from '../src/server.js'
import { createItem } from '../src/item-store.js'

const NOW = new Date('2027-02-10T00:00:00.000Z')
const DIRECT_URL = 'https://www.myer.com.au/p/springfree-medium-oval'
const ENTRY = { retailer: 'Myer', url: DIRECT_URL, category: 'base', parser: 'jsonld' }
const ITEM = { id: 'tramp', name: 'Springfree medium oval' }

test('a blocked source whose note names a CAPTCHA or bot protection is a bot check', () => {
  const notes = [
    'Showed a CAPTCHA before the product page',
    'Bot check page on every attempt',
    'Bot-detection page (\'Pardon Our Interruption\') on both product pages',
    'Please verify you are human',
    'Access Denied',
    'Cloudflare challenge',
    'PerimeterX px-captcha wall',
    'Akamai blocked the request',
    'DataDome interstitial',
    'Search page returned HTTP 403.',
    'challenge page instead of product page'
  ]
  notes.forEach((note) => assert.equal(isBotCheck({ status: 'blocked', note }), true, note))
})

test('rate limits, timeouts, other errors, and other statuses are not bot checks', () => {
  const notes = [
    'Kärcher collection returned HTTP 429 twice.',
    'skipped after HTTP 429 from this site',
    'Product pages timed out (60s) on every attempt.',
    'Returned HTTP 503 Service Unavailable',
    'Search page timed out after 60 s.',
    'robots.txt disallows the search page',
    ''
  ]
  notes.forEach((note) => assert.equal(isBotCheck({ status: 'blocked', note }), false, note))
  assert.equal(isBotCheck({ status: 'error', note: 'CAPTCHA page' }), false)
  assert.equal(isBotCheck({ status: 'ok', note: 'No captcha today' }), false)
  assert.equal(isBotCheck(), false)
})

test('a direct check that returned a challenge page counts as a bot check', () => {
  const page = '<html><title>Just a moment...</title></html>'
  assert.equal(isBotCheck(parseJsonLd({ body: page, entry: ENTRY })), true)
  assert.equal(isBotCheck(parseShopify({ body: page, entry: { ...ENTRY, parser: 'shopify' } })),
    true)
})

test('only the latest check decides, and a later Chrome check clears the bot check', () => {
  const block = { at: '2027-02-09T00:00:00.000Z', mode: 'research', status: 'blocked',
    note: 'CAPTCHA page' }
  const ok = { at: '2027-02-09T06:00:00.000Z', mode: 'research', status: 'ok', note: '' }
  const chrome = { ...ok, mode: 'manual' }
  assert.deepEqual(botCheckOf({ recent: [block] }), {
    at: block.at, note: block.note, url: null, urlKind: null
  })
  assert.equal(botCheckOf({ recent: [{ ...block, url: 'https://shop.au/p' }] }).url,
    'https://shop.au/p')
  assert.equal(botCheckOf({ recent: [ok, block] }), null)
  assert.equal(botCheckOf({ recent: [chrome, block] }), null)
  assert.equal(botCheckOf({ state: 'muted', recent: [block] }), null)
  assert.equal(botCheckOf({ state: 'off', recent: [block] }), null)
  assert.deepEqual(botCheckOf({ state: 'weekly', recent: [block] })?.at, block.at)
  assert.equal(botCheckOf({ recent: [] }), null)
})

test('flags skip rows the user has seen at that block time and other kinds of row', () => {
  const recent = (at) => [{
    at, mode: 'research', status: 'blocked', note: 'HTTP 403', url: 'https://www.binglee.com.au/'
  }]
  const rows = [
    { kind: 'site', key: 'Bing Lee', name: 'Bing Lee', recent: recent('2027-02-09T00:00:00Z') },
    { kind: 'site', key: 'Myer', name: 'Myer', recent: recent('2027-02-08T00:00:00Z') },
    { kind: 'other', key: 'Kogan', name: 'Kogan', recent: recent('2027-02-08T00:00:00Z') }
  ]
  const seen = {
    itemId: 'tramp', reason: BOT_CHECK_SEEN_REASON,
    changes: seenRecord({ kind: 'site', key: 'Myer', at: '2027-02-08T00:00:00Z' })
  }
  const flags = botCheckFlags({ item: ITEM, rows, feedback: [seen] })
  assert.deepEqual(flags.map(({ name }) => name), ['Bing Lee'])
  assert.deepEqual(flags[0], {
    itemId: 'tramp', itemName: 'Springfree medium oval', kind: 'site', key: 'Bing Lee',
    name: 'Bing Lee', at: '2027-02-09T00:00:00Z', note: 'HTTP 403',
    url: 'https://www.binglee.com.au/', urlKind: null
  })
})

test('GET /api/bot-checks lists unseen bot checks and Got it marks them seen', async () => {
  await withServer(async ({ db, get, send }) => {
    const first = await get('/api/bot-checks')
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.checks.map(({ kind, name }) => `${kind}:${name}`).sort(),
      ['direct:Myer', 'site:Bing Lee'])
    const seen = await send({ path: '/api/bot-checks/seen', body: { checks: first.body.checks } })
    assert.equal(seen.status, 201)
    assert.equal(seen.body.seen, 2)
    assert.deepEqual((await get('/api/bot-checks')).body.checks, [])
    const rows = feedbackFor({ db, itemId: 'tramp' })
    assert.deepEqual([...new Set(rows.map(({ reason, by }) => `${reason} by ${by}`))],
      [`${BOT_CHECK_SEEN_REASON} by Dashboard`])
    addRun({ db, mode: 'research', hoursAgo: 1, sources: [
      { name: 'Myer', status: 'ok', note: 'Listed' },
      { name: 'Bing Lee', status: 'blocked', note: 'Bot check page again' }
    ] })
    const again = await get('/api/bot-checks')
    assert.deepEqual(again.body.checks.map(({ name, note }) => `${name}: ${note}`),
      ['Bing Lee: Bot check page again'])
  })
})

test('POST /api/bot-checks/seen ignores unknown checks and rejects a bad body', async () => {
  await withServer(async ({ send }) => {
    const unknown = await send({ path: '/api/bot-checks/seen', body: {
      checks: [{ itemId: 'tramp', kind: 'site', key: 'Myer', at: NOW.toISOString() }]
    } })
    assert.equal(unknown.status, 201)
    assert.equal(unknown.body.seen, 0)
    const bad = await send({ path: '/api/bot-checks/seen', body: { checks: 'all' } })
    assert.equal(bad.status, 400)
  })
})

test('site stats mark the bot check rows and leave rate-limited rows alone', async () => {
  await withServer(async ({ get }) => {
    const { body } = await get('/api/items/tramp/site-stats?days=30')
    const byName = new Map(body.sites.map((row) => [`${row.kind}:${row.name}`, row.botCheck]))
    assert.equal(byName.get('site:Bing Lee').note, 'Showed a CAPTCHA')
    assert.equal(byName.get('direct:Myer').note, 'challenge page instead of product page')
    assert.equal(byName.get('site:Myer'), null)
    assert.equal(byName.get('site:JB Hi-Fi'), null)
  })
})

const config = () => ({
  id: 'tramp',
  name: 'Springfree medium oval',
  product: 'A Springfree O77',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'tramp-topic' },
  categories: [{ id: 'base', description: 'O77 alone' }],
  rules: { base: { maxPrice: 1500 } },
  sources: {
    sites: [{ name: 'Myer' }, { name: 'Bing Lee' }, { name: 'JB Hi-Fi' }],
    searches: ['springfree o77']
  },
  direct: [ENTRY],
  directSchedules: [{ cron: '30 7 * * *', tz: 'Australia/Sydney' }],
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: false }
})

const addRun = ({ db, mode, hoursAgo, sources }) => {
  const startedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString()
  const runId = startRun({ db, itemId: 'tramp', trigger: 'tick', startedAt, mode,
    itemVersion: 1 })
  finishRun({
    db, runId, status: 'ok', finishedAt: startedAt,
    research: { checkedAt: startedAt, sources, listings: [] }, decision: { qualified: [] }
  })
}

const seed = (db) => {
  createItem({ db, config: config(), now: NOW })
  addRun({ db, mode: 'research', hoursAgo: 48, sources: [
    { name: 'Myer', status: 'blocked', note: 'CAPTCHA page' },
    { name: 'Bing Lee', status: 'ok', note: '' },
    { name: 'JB Hi-Fi', status: 'blocked', note: 'HTTP 429' }
  ] })
  addRun({ db, mode: 'research', hoursAgo: 24, sources: [
    { name: 'Myer', status: 'ok', note: 'Listed' },
    { name: 'Bing Lee', status: 'blocked', note: 'Showed a CAPTCHA' },
    { name: 'JB Hi-Fi', status: 'blocked', note: 'HTTP 429 rate limit' }
  ] })
  addRun({ db, mode: 'direct', hoursAgo: 12, sources: [
    { name: 'Myer direct springfree-medium-oval', status: 'blocked',
      note: 'challenge page instead of product page' }
  ] })
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
