import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  claudeConnection, isLoginError, recordClaudeLogin, recordClaudeOutcome
} from '../src/claude-connection.js'
import { testClaudeLogin } from '../src/claude-check.js'
import { currentGuard, guardMessage, noticeFor, skipReason } from '../src/claude-guard.js'
import { claudeUsageView } from '../src/claude-usage-view.js'
import { openDb, recentRuns } from '../src/db.js'
import { createItem, findItem } from '../src/item-store.js'
import { research } from '../src/research.js'
import { runItem, tick } from '../src/runner.js'
import { createApp } from '../src/server.js'
import { setSetting } from '../src/settings.js'
import { scriptedClaude } from './fake-claude.js'

const NOW = new Date('2026-11-08T00:00:00Z')
const TOKEN = 'sk-ant-oat01-new-token-5555'
const NOT_LOGGED_IN = 'Not logged in · Please run /login'

test('a fresh install counts as connected until Claude reports a login error', () => {
  const db = openDb(':memory:')
  assert.equal(claudeConnection({ db, env: {} }).connected, true)
  recordClaudeLogin({ db, ok: false, error: NOT_LOGGED_IN, env: {}, now: NOW })
  assert.deepEqual(claudeConnection({ db, env: {} }),
    { connected: false, source: 'local', checkedAt: NOW.toISOString(), error: NOT_LOGGED_IN })
  recordClaudeLogin({ db, ok: true, env: {}, now: NOW })
  assert.equal(claudeConnection({ db, env: {} }).connected, true)
})

test('a new token reconnects, and a rejected token disconnects only that token', () => {
  const db = openDb(':memory:')
  recordClaudeLogin({ db, ok: false, error: NOT_LOGGED_IN, env: {}, now: NOW })
  setSetting({ db, key: 'claudeOauthToken', value: TOKEN })
  assert.deepEqual(
    [claudeConnection({ db, env: {} }).connected, claudeConnection({ db, env: {} }).source],
    [true, 'token'])
  recordClaudeLogin({ db, ok: false, error: 'Invalid API key', env: {}, now: NOW })
  assert.equal(claudeConnection({ db, env: {} }).connected, false)
  setSetting({ db, key: 'claudeOauthToken', value: `${TOKEN}-2` })
  assert.equal(claudeConnection({ db, env: {} }).connected, true)
})

test('only login errors change the connection', () => {
  const db = openDb(':memory:')
  assert.equal(isLoginError(`claude reported an error (success): ${NOT_LOGGED_IN}`), true)
  assert.equal(isLoginError('claude timed out after 900 s'), false)
  const timeout = Object.assign(new Error('claude timed out'), { kind: 'timeout' })
  assert.equal(recordClaudeOutcome({ db, error: timeout, env: {} }), false)
  assert.equal(claudeConnection({ db, env: {} }).connected, true)
  const login = Object.assign(new Error(NOT_LOGGED_IN), { kind: 'login' })
  assert.equal(recordClaudeOutcome({ db, error: login, env: {} }), true)
  assert.equal(claudeConnection({ db, env: {} }).connected, false)
})

test('the guard waits for Claude without a usage notice', () => {
  const db = openDb(':memory:')
  recordClaudeLogin({ db, ok: false, error: NOT_LOGGED_IN, env: {}, now: NOW })
  const decision = currentGuard({ db, now: NOW, env: {} })
  assert.deepEqual(decision, { allow: false, reason: 'disconnected', resumesAt: null })
  assert.equal(skipReason(decision), 'Skipped: Claude is not connected')
  assert.match(guardMessage(decision), /^Claude is not connected\. Add a Claude login token/)
  assert.equal(noticeFor({ decision, stored: null }), null)
  assert.equal(claudeUsageView({ db, now: NOW, env: {} }).connection.connected, false)
})

test('the login test records the login state', async () => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'login-state-'))
  const failing = scriptedClaude([{ resultText: NOT_LOGGED_IN, isError: true }])
  const failed = await testClaudeLogin({
    db, env: {}, spawnImpl: failing.spawnImpl, claudeLockPath: join(dir, 'claude.lock'), cwd: dir
  })
  assert.equal(failed.ok, false)
  assert.equal(claudeConnection({ db, env: {} }).connected, false)
  const working = scriptedClaude([{ resultText: 'ok' }])
  const passed = await testClaudeLogin({
    db, env: {}, spawnImpl: working.spawnImpl, claudeLockPath: join(dir, 'claude.lock'), cwd: dir
  })
  assert.equal(passed.ok, true)
  assert.equal(claudeConnection({ db, env: {} }).connected, true)
})

test('research flags a login error from the real Not logged in envelope', async () => {
  const claude = scriptedClaude([{ resultText: NOT_LOGGED_IN, isError: true, cost: 0 }])
  const result = await research({ item: researchItem(), now: NOW, spawnImpl: claude.spawnImpl })
  assert.equal(result.ok, false)
  assert.equal(result.loginError, true)
  assert.equal(claude.calls.length, 1)
})

test('a research run that hits a login error is skipped and disconnects Claude', async () => {
  const db = openDb(':memory:')
  const sent = []
  const result = await runItem({
    item: researchItem(), trigger: 'tick', now: NOW, db,
    deps: {
      log: () => {},
      appNotice: async (notice) => { sent.push(notice) },
      deliver: async (alert) => { sent.push(alert); return { delivered: true } },
      research: async () => ({ ok: false, loginError: true, errors: [NOT_LOGGED_IN] })
    }
  })
  assert.deepEqual([result.status, result.error], ['skipped', 'Skipped: Claude is not connected'])
  assert.deepEqual(recentRuns({ db }).map(({ status }) => status), ['skipped'])
  assert.equal(claudeConnection({ db }).connected, false)
  assert.deepEqual(sent, [])
})

test('tick skips AI research while Claude is not connected and keeps free checks', async () => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'disconnected-tick-'))
  recordClaudeLogin({ db, ok: false, error: NOT_LOGGED_IN, now: NOW })
  const calls = { research: 0, direct: 0, notices: 0 }
  const deps = {
    research: async () => { calls.research += 1; return { ok: false, errors: ['x'] } },
    direct: async () => {
      calls.direct += 1
      return { ok: true, data: { checkedAt: NOW.toISOString(), sources: [], listings: [] } }
    },
    appNotice: async () => { calls.notices += 1 }
  }
  const item = {
    ...researchItem(),
    direct: [{
      retailer: 'Shop', url: 'https://shop.example.com.au/p/k7', category: 'smart',
      parser: 'jsonld'
    }],
    directSchedules: [{ cron: '30 7 * * *', tz: 'Australia/Sydney' }]
  }
  const run = (now) => tick({
    now, db, deps, log: () => {}, items: [{ item, version: 1 }], lockPath: join(dir, 'tick.lock')
  })
  const first = await run(NOW)
  assert.deepEqual(first.map(({ mode, action }) => [mode, action]),
    [['research', 'skipped-claude-guard'], ['direct', 'ran']])
  assert.equal(first[0].reason, 'Skipped: Claude is not connected')
  const later = await run(new Date(NOW.getTime() + 15 * 60_000))
  assert.equal(later[0].action, 'not-due')
  assert.deepEqual(calls, { research: 0, direct: 1, notices: 0 })
  assert.equal(recentRuns({ db }).filter(({ status }) => status === 'failed').length, 0)
})

test('run now answers 409 while Claude is not connected, even with run anyway', async () => {
  const spawned = []
  await withServer(async ({ db, send }) => {
    recordClaudeLogin({ db, ok: false, error: NOT_LOGGED_IN, env: {}, now: NOW })
    for (const runAnyway of [false, true]) {
      const refused = await send({ path: '/api/items/k7/run', body: { runAnyway } })
      assert.equal(refused.status, 409)
      assert.match(refused.body.error, /^Claude is not connected\./)
      assert.equal(refused.body.guard.reason, 'disconnected')
    }
    assert.equal(spawned.length, 0)
  }, { spawnImpl: (...args) => { spawned.push(args); return { unref: () => {} } } })
})

test('an item added by hand gets the wizard defaults and a free check', async () => {
  const delivered = []
  await withServer(async ({ db, send }) => {
    const created = await send({
      path: '/api/items',
      body: {
        name: 'Dyson V15 Detect',
        lookFor: 'Dyson V15 Detect cordless vacuum, new.',
        category: 'V15 Detect',
        alertPrice: 899,
        url: 'https://shop.example.com.au/p/v15'
      }
    })
    assert.equal(created.status, 201)
    const { itemId, freeCheck, testDelivered } = created.body
    assert.deepEqual([itemId, freeCheck.added, testDelivered], ['dyson-v15-detect', true, true])
    const { config } = findItem({ db, id: 'dyson-v15-detect' })
    assert.deepEqual(config.categories.map(({ id }) => id), ['v15-detect'])
    assert.deepEqual(config.rules['v15-detect'],
      { maxPrice: 899, rrp: null, minPctBelowRrp: null })
    assert.deepEqual(config.direct.map(({ parser, category }) => [parser, category]),
      [['jsonld', 'v15-detect']])
    assert.equal(config.directSchedules.length, 1)
    assert.match(config.ntfy.topic, /^pt-dyson-v15-detect-[0-9a-f]+$/)
    assert.equal(config.ntfy.server, 'https://ntfy.sh')
    assert.equal(config.schedules.length, 1)
    assert.equal(delivered.length, 1)
  }, {
    fetchImpl: async () => response(jsonLdPage(799)),
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    deliver: async (options) => { delivered.push(options); return { delivered: true } }
  })
})

test('a hand-made item is checked like any other item', async () => {
  await withServer(async ({ send }) => {
    const missing = await send({ path: '/api/items', body: { name: '', alertPrice: -1 } })
    assert.equal(missing.status, 400)
    assert.deepEqual(missing.body.errors.map((error) => error.split(':')[0]),
      ['name', 'lookFor', 'alertPrice'])
    const badUrl = await send({
      path: '/api/items',
      body: { name: 'K7', lookFor: 'K7', alertPrice: 900, url: 'http://192.168.1.2/x' }
    })
    assert.equal(badUrl.status, 400)
    assert.match(badUrl.body.errors[0], /^url:/)
    const plain = await send({
      path: '/api/items', body: { name: 'Karcher K7', lookFor: 'Karcher K7', alertPrice: 900 }
    })
    assert.equal(plain.status, 201)
    assert.equal(plain.body.itemId, 'karcher-k7-2')
    assert.deepEqual(plain.body.freeCheck, { requested: false, added: false, note: null })
  }, { deliver: async () => ({ delivered: true }) })
})

const researchItem = () => ({
  id: 'k7',
  name: 'Karcher K7',
  product: 'Karcher K7 pressure washer',
  enabled: true,
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'topic-1' },
  categories: [{ id: 'smart', description: 'Smart' }],
  rules: { smart: { maxPrice: 1100 } },
  sources: { sites: [{ name: 'Bunnings' }], searches: ['K7'] },
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: false }
})

const withServer = async (fn, { spawnImpl, fetchImpl, lookupImpl, deliver } = {}) => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'connection-api-'))
  createItem({ db, config: { ...researchItem(), id: 'karcher-k7' }, now: NOW })
  createItem({ db, config: researchItem(), now: NOW })
  const app = createApp({
    db, env: {}, distDir: '/nonexistent', lockPath: join(dir, 'tick.lock'),
    ...(spawnImpl ? { spawnImpl } : {}), ...(fetchImpl ? { fetchImpl } : {}),
    ...(lookupImpl ? { lookupImpl } : {}), ...(deliver ? { deliver } : {})
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const send = async ({ path, body = {} }) => {
    const reply = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: reply.status, body: await reply.json() }
  }
  try {
    await fn({ db, send })
  } finally {
    server.close()
  }
}

const jsonLdPage = (price) => `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Dyson V15 Detect',
  offers: {
    '@type': 'Offer', price: String(price), priceCurrency: 'AUD',
    availability: 'https://schema.org/InStock'
  }
})}</script></head><body></body></html>`

const response = (body) => ({
  status: 200,
  ok: true,
  headers: new Headers({ 'content-type': 'text/html' }),
  text: async () => body
})

test('a lost login is rechecked at most every six hours, never when connected', async () => {
  const { recheckDisconnected, RECHECK_KEY } = await import('../src/claude-check.js')
  const { recordClaudeLogin } = await import('../src/claude-connection.js')
  const { openDb } = await import('../src/db.js')
  const db = openDb(':memory:')
  const env = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-test' }
  const now = new Date('2026-11-11T00:00:00Z')
  assert.equal(await recheckDisconnected({ db, env, now }), null)
  recordClaudeLogin({ db, ok: false, error: 'Not logged in', env, now })
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :value)')
    .run({ key: RECHECK_KEY, value: '2026-11-10T20:00:00.000Z' })
  assert.equal(await recheckDisconnected({ db, env, now }), null)
})
