import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb, recentAlerts, recentRuns } from '../src/db.js'
import { createDraftWorker } from '../src/draft-worker.js'
import { createApp } from '../src/server.js'
import { findItem, itemVersions } from '../src/item-store.js'
import {
  fenced, publicLookup, researchDraft, scopeQuestions, scriptedClaude, shopifyFetch
} from './fake-claude.js'

const NOW = new Date('2026-11-08T00:00:00Z')

const withServer = async (fn, { env = {}, replies = [] } = {}) => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'server-drafts-'))
  const claude = scriptedClaude(replies)
  const fetch = shopifyFetch()
  const delivered = []
  const deliver = async ({ item, alert }) => {
    delivered.push({ topic: item.ntfy.topic, title: alert.title })
    return { delivered: true }
  }
  const worker = createDraftWorker({
    db, spawnImpl: claude.spawnImpl, fetchImpl: fetch.fetchImpl, lookupImpl: publicLookup,
    sleep: async () => {}, pauseMs: 0, now: () => NOW, claudeLockPath: join(dir, 'claude.lock'),
    cwd: join(dir, 'work'), notify: async () => {}, log: () => {}
  })
  const app = createApp({
    db, now: () => NOW, env, deliver, worker, fetchImpl: fetch.fetchImpl, lookupImpl: publicLookup,
    sleep: async () => {}, pauseMs: 0, lockPath: join(dir, 'tick.lock'), distDir: '/nonexistent'
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const send = async (path, body = {}, method = 'POST') => {
    const response = await globalThis.fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
  }
  const get = async (path) => {
    const response = await globalThis.fetch(`${base}${path}`)
    return { status: response.status, body: await response.json() }
  }
  try {
    await fn({ db, send, get, worker, delivered, base, requests: fetch.requests })
  } finally {
    server.close()
  }
}

const input = { request: 'Dyson V15 Detect cordless vacuum, around $900', budget: 900,
  needBy: '2026-12-20' }

const happyReplies = [
  { resultText: fenced(scopeQuestions) },
  { resultText: fenced(researchDraft()) }
]

const reviewDraft = async ({ send, get, worker }) => {
  const created = await send('/api/drafts', { input })
  await worker.kick()
  await send(`/api/drafts/${created.body.id}/answers`,
    { answers: [{ questionId: 'q1', choiceIds: ['a', 'b'] }] })
  await worker.kick()
  return (await get(`/api/drafts/${created.body.id}`)).body
}

test('POST /api/drafts validates the input', async () => {
  await withServer(async ({ send }) => {
    const bad = await send('/api/drafts', {
      input: { request: '', budget: 'lots', needBy: '2020-01-01',
        links: ['http://192.168.1.1/x'] }
    })
    assert.equal(bad.status, 400)
    assert.deepEqual(bad.body.errors.map((error) => error.split(':')[0]),
      ['request', 'budget', 'needBy', 'links[0]'])
  })
})

test('a draft goes from create to answers to review, then saves as a wizard item', async () => {
  await withServer(async ({ db, send, get, worker, delivered }) => {
    const created = await send('/api/drafts', { input })
    assert.equal(created.status, 202)
    assert.equal(created.body.status, 'scoping')
    const list = await get('/api/drafts')
    assert.deepEqual(list.body.map(({ id, status }) => [id, status]),
      [[created.body.id, 'scoping']])
    await worker.kick()
    const asking = await get(`/api/drafts/${created.body.id}`)
    assert.equal(asking.body.status, 'clarifying')
    assert.equal(asking.body.sessionId, undefined)
    assert.equal(asking.body.usage.cap, 150)
    const answered = await send(`/api/drafts/${created.body.id}/answers`,
      { answers: [{ questionId: 'q1', choiceIds: ['a'] }] }, 'POST')
    assert.equal(answered.status, 202)
    await worker.kick()
    const draft = (await get(`/api/drafts/${created.body.id}`)).body
    assert.equal(draft.status, 'review')
    const saved = await send(`/api/drafts/${draft.id}/save`, {
      config: { ...draft.config, id: 'hijack', ntfy: { server: 'https://evil.example.com',
        topic: 'evil' }, name: 'My Dyson' }
    })
    assert.equal(saved.status, 201)
    assert.equal(saved.body.itemId, 'dyson-v15-detect')
    assert.equal(saved.body.ntfy.server, 'https://ntfy.sh')
    assert.equal(saved.body.ntfy.topic, draft.config.ntfy.topic)
    assert.equal(saved.body.snapshot.imported, 1)
    assert.equal(saved.body.testDelivered, true)
    const record = findItem({ db, id: 'dyson-v15-detect', now: NOW })
    assert.deepEqual([record.origin, record.version, record.config.name], ['app', 1, 'My Dyson'])
    assert.equal(itemVersions({ db, id: record.id })[0].source, 'wizard')
    const [run] = recentRuns({ db, itemId: record.id })
    assert.deepEqual([run.mode, run.trigger, run.listingCount], ['manual', 'manual', 1])
    assert.deepEqual(delivered.map(({ topic }) => topic), [draft.config.ntfy.topic])
    assert.equal(recentAlerts({ db, itemId: record.id })[0].kind, 'test')
    const after = await get(`/api/drafts/${draft.id}`)
    assert.deepEqual([after.body.status, after.body.itemId], ['saved', record.id])
    assert.equal((await get('/api/drafts')).body.length, 0)
  }, { replies: happyReplies })
})

test('save is blocked when the schedule would pass the monthly cap', async () => {
  await withServer(async ({ send, get, worker }) => {
    const draft = await reviewDraft({ send, get, worker })
    const blocked = await send(`/api/drafts/${draft.id}/save`, {})
    assert.equal(blocked.status, 409)
    assert.match(blocked.body.error, /over the monthly cap of 10/)
  }, { replies: happyReplies, env: { AI_MONTHLY_CAP: '10' } })
})

test('Ask AI to change returns a full config that needs approval', async () => {
  const changed = researchDraft({
    rules: { 'v15-absolute': { maxPrice: 849, rrp: 1399, minPctBelowRrp: 35 } },
    directCandidates: []
  })
  await withServer(async ({ send, get, worker }) => {
    const draft = await reviewDraft({ send, get, worker })
    const queued = await send(`/api/drafts/${draft.id}/change`,
      { instruction: 'Lower the alert to $849', config: draft.config })
    assert.equal(queued.status, 202)
    await worker.kick()
    const ready = (await get(`/api/drafts/${draft.id}`)).body
    assert.equal(ready.pendingChange.state, 'ready')
    assert.equal(ready.config.rules['v15-absolute'].maxPrice, 899)
    assert.equal(ready.pendingChange.config.rules['v15-absolute'].maxPrice, 849)
    assert.equal(ready.pendingChange.config.ntfy.topic, draft.config.ntfy.topic)
    const approved = await send(`/api/drafts/${draft.id}/change/decision`, { approve: true })
    assert.equal(approved.body.config.rules['v15-absolute'].maxPrice, 849)
    assert.equal(approved.body.pendingChange, null)
  }, { replies: [...happyReplies, { resultText: fenced(changed) }] })
})

test('the free direct test reports what would qualify', async () => {
  await withServer(async ({ send, get, worker }) => {
    const draft = await reviewDraft({ send, get, worker })
    const result = await send(`/api/drafts/${draft.id}/test`, { kind: 'direct' })
    assert.equal(result.status, 200)
    const [listing] = result.body.direct.listings
    assert.deepEqual([listing.price, listing.qualifies], [929, false])
    assert.match(listing.reasons.join(' '), /\$899/)
  }, { replies: happyReplies })
})

test('draft direct tests reject a private address with 400 before any fetch', async () => {
  await withServer(async ({ send, get, worker, requests }) => {
    const draft = await reviewDraft({ send, get, worker })
    const fetchedBefore = requests.length
    const entry = {
      retailer: 'NAS', url: 'http://192.168.1.1:5000/', category: 'v15-absolute', parser: 'jsonld'
    }
    const single = await send(`/api/drafts/${draft.id}/direct/test`, { entry })
    assert.equal(single.status, 400)
    const config = { ...draft.config, direct: [entry] }
    const dryRun = await send(`/api/drafts/${draft.id}/test`, { kind: 'direct', config })
    assert.equal(dryRun.status, 400)
    assert.match(dryRun.body.error, /direct\[0\]\.url/)
    assert.equal(requests.length, fetchedBefore)
  }, { replies: happyReplies })
})

test('cancel and retry follow the state machine', async () => {
  await withServer(async ({ send, get, worker }) => {
    const created = await send('/api/drafts', { input })
    await worker.kick()
    const stopped = (await get(`/api/drafts/${created.body.id}`)).body
    assert.deepEqual([stopped.status, stopped.errorKind], ['failed', 'limited'])
    const retried = await send(`/api/drafts/${created.body.id}/retry`)
    assert.deepEqual([retried.status, retried.body.status], [202, 'scoping'])
    const cancelled = await send(`/api/drafts/${created.body.id}/cancel`)
    assert.equal(cancelled.body.status, 'cancelled')
    const again = await send(`/api/drafts/${created.body.id}/retry`)
    assert.equal(again.status, 409)
    assert.equal((await get('/api/drafts/nope')).status, 404)
  }, { replies: [{ resultText: 'usage limit reached', isError: true }] })
})

test('draft routes need a session when a password is set', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await globalThis.fetch(`${base}/api/drafts`)).status, 401)
    const response = await globalThis.fetch(`${base}/api/drafts`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.test' },
      body: JSON.stringify({ input })
    })
    assert.equal(response.status, 403)
  }, { env: { APP_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(40) } })
})
