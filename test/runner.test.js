import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  insertAlert, lastAlertsFor, openDb, recentAlerts, recentRuns, runListings, startRun, finishRun
} from '../src/db.js'
import { runItem, sendTestNotification, tick } from '../src/runner.js'
import { setSetting } from '../src/settings.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')

const makeItem = (overrides = {}) => ({
  id: 'k7',
  name: 'Karcher K7',
  enabled: true,
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'topic-1' },
  categories: [{ id: 'smart', description: 'Smart' }],
  rules: { smart: { maxPrice: 1100 } },
  dedupe: { minDrop: 25 },
  heartbeat: { monthly: true },
  ...overrides
})

const listing = (overrides = {}) => ({
  retailer: 'Bunnings',
  title: 'K7 Smart Control',
  category: 'smart',
  rejectReason: null,
  price: 1000,
  wasPrice: null,
  effectivePrice: 1000,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://www.bunnings.com.au/k7',
  evidence: 'page',
  notes: '',
  ...overrides
})

const researchResult = (listings) => ({
  ok: true,
  costUsd: 0.5,
  data: {
    checkedAt: NOW.toISOString(),
    sources: [{ name: 'Bunnings', status: 'ok', note: '' }],
    listings
  }
})

const makeDeps = ({ listings = [listing()], delivered = true, researchFails = false } = {}) => {
  const calls = { research: 0, deliver: [] }
  return {
    calls,
    log: () => {},
    research: async () => {
      calls.research += 1
      if (researchFails) return { ok: false, errors: ['bad json'], attempts: 2 }
      return researchResult(listings)
    },
    deliver: async ({ alert }) => {
      calls.deliver.push(alert)
      return delivered ? { delivered: true } : { delivered: false, error: 'ntfy down' }
    }
  }
}

const withoutHeartbeat = (item = {}) => makeItem({ heartbeat: { monthly: false }, ...item })

const kinds = (db) => recentAlerts({ db, limit: 20 }).map((alert) => alert.kind).sort()

test('successful run records listings and a delivered deal alert', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({
    listings: [listing(), listing({ retailer: 'Rejected', category: 'reject' })]
  })
  const result = await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  assert.equal(result.status, 'ok')
  assert.equal(deps.calls.deliver.length, 1)
  assert.equal(deps.calls.deliver[0].title, 'Karcher K7 deal found')
  const stored = runListings({ db, runId: result.runId })
  assert.equal(stored.length, 2)
  assert.equal(stored.find((row) => row.retailer === 'Bunnings').qualifies, true)
  assert.equal(stored.find((row) => row.retailer === 'Rejected').qualifies, false)
  const [alert] = recentAlerts({ db, limit: 5 })
  assert.equal(alert.kind, 'deal')
  assert.equal(alert.delivered, true)
  assert.equal(alert.retailer, 'Bunnings')
  const [run] = recentRuns({ db, itemId: 'k7', limit: 1 })
  assert.equal(run.status, 'ok')
  assert.equal(run.costUsd, 0.5)
})

test('run stores the canonical retailer and notes the seller', async () => {
  const db = openDb(':memory:')
  const variant = 'Bunnings Warehouse (sold by Acme Pty Ltd)'
  const deps = makeDeps({ listings: [listing({ retailer: variant, notes: 'Home kit' })] })
  const item = withoutHeartbeat({ sources: { sites: [{ name: 'Bunnings' }] } })
  const result = await runItem({ item, now: NOW, db, deps })
  const [stored] = runListings({ db, runId: result.runId })
  assert.equal(stored.retailer, 'Bunnings')
  assert.equal(stored.notes, `Sold by Acme Pty Ltd; Listed as: ${variant}; Home kit`)
  assert.equal(recentAlerts({ db, limit: 1 })[0].retailer, 'Bunnings')
})

test('run uses the stored token and the stored delivery location', async () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'ntfyToken', value: 'stored-token-1234' })
  setSetting({ db, key: 'deliveryPostcode', value: '3000' })
  const deps = makeDeps()
  const tokens = []
  const deliveries = []
  const base = deps.deliver
  deps.deliver = async (call) => {
    tokens.push(call.token)
    return base(call)
  }
  const baseResearch = deps.research
  deps.research = async (call) => {
    deliveries.push(call.delivery)
    return baseResearch(call)
  }
  await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  assert.deepEqual(tokens, ['stored-token-1234'])
  assert.equal(deliveries[0].postcode, '3000')
})

test('run stores a members-only listing as rejected with the membership reason', async () => {
  const db = openDb(':memory:')
  const tradeUrl = 'https://trade.bunnings.com.au/p/k7'
  const deps = makeDeps({ listings: [listing({ url: tradeUrl })] })
  const result = await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  const [stored] = runListings({ db, runId: result.runId })
  assert.equal(stored.category, 'reject')
  assert.equal(stored.rejectReason, 'Needs Bunnings PowerPass (not in your memberships)')
  assert.equal(stored.qualifies, false)
  assert.equal(deps.calls.deliver.length, 0)
})

test('run keeps a members-only listing when the membership is stored', async () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'memberships', value: 'eBay Plus, bunnings powerpass' })
  const deps = makeDeps({ listings: [listing({ url: 'https://trade.bunnings.com.au/p/k7' })] })
  const result = await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  const [stored] = runListings({ db, runId: result.runId })
  assert.equal(stored.category, 'smart')
  assert.equal(stored.qualifies, true)
})

test('run passes the memberships to research', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps()
  const seen = []
  const baseResearch = deps.research
  deps.research = async (call) => {
    seen.push(call.memberships)
    return baseResearch(call)
  }
  await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  assert.deepEqual(seen, [['eBay Plus']])
})

test('deal alert clicks through to the dashboard alert page with the listing as an action',
  async () => {
  const db = openDb(':memory:')
  const deps = makeDeps()
  const result = await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  const [sent] = deps.calls.deliver
  const [alert] = recentAlerts({ db, limit: 1 })
  assert.equal(sent.click, `http://localhost:4280/#/item/k7/alert/${alert.id}`)
  assert.deepEqual(sent.actions, [
    { action: 'view', label: 'Open listing', url: 'https://www.bunnings.com.au/k7', clear: false }
  ])
  assert.equal(alert.url, 'https://www.bunnings.com.au/k7')
  assert.equal(alert.delivered, true)
  assert.equal(result.delivery.deal.delivered, true)
})

test('deal alert row exists before sending and records a failed delivery', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({ delivered: false })
  const base = deps.deliver
  const seen = []
  deps.deliver = async (call) => {
    seen.push(recentAlerts({ db, limit: 5 }).map(({ id, delivered }) => ({ id, delivered })))
    return base(call)
  }
  await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  assert.equal(seen[0].length, 1)
  assert.equal(seen[0][0].delivered, false)
  const [alert] = recentAlerts({ db, limit: 1 })
  assert.equal(alert.delivered, false)
  assert.equal(alert.error, 'ntfy down')
})

test('heartbeat clicks to the item page and uses the stored dashboard URL', async () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'dashboardUrl', value: 'https://tracker.example/' })
  const deps = makeDeps()
  await runItem({ item: makeItem(), now: NOW, db, deps })
  const heartbeat = deps.calls.deliver.find((alert) => alert.title.includes('still tracking'))
  assert.equal(heartbeat.click, 'https://tracker.example/#/item/k7')
  assert.equal(heartbeat.actions, undefined)
})

test('test notifications click to the settings page', async () => {
  const db = openDb(':memory:')
  const calls = []
  await sendTestNotification({
    item: makeItem(),
    db,
    deliver: async (call) => { calls.push(call); return { delivered: true } }
  })
  assert.equal(calls[0].alert.click, 'http://localhost:4280/#/settings')
})

test('second identical run is deduped and sends no alert', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps()
  const item = withoutHeartbeat()
  await runItem({ item, now: NOW, db, deps })
  const second = await runItem({ item, now: new Date(NOW.getTime() + 86_400_000), db, deps })
  assert.equal(second.status, 'ok')
  assert.equal(second.messages.deal, null)
  assert.equal(deps.calls.deliver.length, 1)
  assert.equal(recentAlerts({ db, limit: 10 }).length, 1)
})

test('failed research marks the run failed and sends nothing', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({ researchFails: true })
  const result = await runItem({ item: makeItem(), now: NOW, db, deps })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /bad json/)
  assert.equal(deps.calls.deliver.length, 0)
  const [run] = recentRuns({ db, itemId: 'k7', limit: 1 })
  assert.equal(run.status, 'failed')
  assert.match(run.error, /bad json/)
  assert.equal(recentAlerts({ db, limit: 10 }).length, 0)
})

test('thrown research error marks the run failed', async () => {
  const db = openDb(':memory:')
  const deps = { ...makeDeps(), research: async () => { throw new Error('spawn exploded') } }
  const result = await runItem({ item: makeItem(), now: NOW, db, deps })
  assert.equal(result.status, 'failed')
  assert.equal(recentRuns({ db, itemId: 'k7', limit: 1 })[0].error, 'spawn exploded')
})

test('undelivered alert is stored with delivered 0 and does not count for dedupe', async () => {
  const db = openDb(':memory:')
  const item = withoutHeartbeat()
  await runItem({ item, now: NOW, db, deps: makeDeps({ delivered: false }) })
  const [alert] = recentAlerts({ db, limit: 5 })
  assert.equal(alert.delivered, false)
  assert.equal(alert.error, 'ntfy down')
  assert.equal(lastAlertsFor({ db, itemId: 'k7' }).size, 0)
  const retryDeps = makeDeps()
  const nextDay = new Date(NOW.getTime() + 86_400_000)
  const retry = await runItem({ item, now: nextDay, db, deps: retryDeps })
  assert.ok(retry.messages.deal)
  assert.equal(retryDeps.calls.deliver.length, 1)
})

test('dry-run sends nothing and inserts no listings or alerts', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps()
  const result = await runItem({ item: makeItem(), dryRun: true, now: NOW, db, deps })
  assert.equal(result.status, 'ok')
  assert.equal(result.dryRun, true)
  assert.ok(result.messages.deal)
  assert.equal(deps.calls.deliver.length, 0)
  assert.equal(runListings({ db, runId: result.runId }).length, 0)
  assert.equal(recentAlerts({ db, limit: 10 }).length, 0)
  const [run] = recentRuns({ db, itemId: 'k7', limit: 1 })
  assert.equal(run.trigger, 'dry-run')
  assert.equal(run.status, 'ok')
})

test('monthly heartbeat is sent once per calendar month', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({ listings: [] })
  const item = makeItem()
  const run = (now) => runItem({ item, now, db, deps })
  await run(NOW)
  assert.deepEqual(kinds(db), ['heartbeat'])
  await run(new Date('2026-11-20T00:00:00.000Z'))
  assert.deepEqual(kinds(db), ['heartbeat'])
  await run(new Date('2026-12-02T00:00:00.000Z'))
  assert.deepEqual(kinds(db), ['heartbeat', 'heartbeat'])
  assert.equal(deps.calls.deliver[0].title, 'Karcher K7 still tracking')
})

const runnable = (...items) => items.map((item) => ({ item, version: 1 }))

const makeLockPath = async () => join(await mkdtemp(join(tmpdir(), 'tick-')), 'tick.lock')

test('tick runs only due items, sequentially', async () => {
  const db = openDb(':memory:')
  const dueItem = withoutHeartbeat({ id: 'due' })
  const freshItem = withoutHeartbeat({ id: 'fresh' })
  const futureItem = withoutHeartbeat({
    id: 'future',
    schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney', from: '2026-12-01' }]
  })
  const freshRun = startRun({
    db, itemId: 'fresh', trigger: 'tick', startedAt: '2026-11-06T23:00:00.000Z'
  })
  finishRun({ db, runId: freshRun, status: 'ok', finishedAt: '2026-11-06T23:05:00.000Z' })
  let active = 0
  let maxActive = 0
  const researched = []
  const deps = {
    ...makeDeps(),
    research: async ({ item }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      researched.push(item.id)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return researchResult([listing()])
    }
  }
  const outcomes = await tick({
    now: NOW,
    db,
    deps,
    log: () => {},
    items: runnable(dueItem, freshItem, futureItem),
    lockPath: await makeLockPath()
  })
  assert.deepEqual(researched, ['due'])
  assert.equal(maxActive, 1)
  assert.deepEqual(outcomes.map(({ itemId, action }) => [itemId, action]), [
    ['due', 'ran'],
    ['fresh', 'not-due'],
    ['future', 'not-due']
  ])
  const [run] = recentRuns({ db, itemId: 'due', limit: 1 })
  assert.equal(run.trigger, 'tick')
  assert.ok(run.slotAt)
})

test('tick skips an item with a failure under 2 hours old', async () => {
  const db = openDb(':memory:')
  const item = withoutHeartbeat()
  const deps = makeDeps({ researchFails: true })
  const lockPath = await makeLockPath()
  const tickAt = (now) => tick({ now, db, deps, log: () => {}, items: runnable(item), lockPath })
  const first = await tickAt(NOW)
  assert.equal(first[0].action, 'ran')
  assert.equal(first[0].result.status, 'failed')
  const soon = new Date(NOW.getTime() + 15 * 60_000)
  const second = await tickAt(soon)
  assert.equal(second[0].action, 'skipped-recent-failure')
  assert.equal(deps.calls.research, 1)
  const later = new Date(NOW.getTime() + 3 * 3_600_000)
  const third = await tickAt(later)
  assert.equal(third[0].action, 'ran')
  assert.equal(deps.calls.research, 2)
})

test('insertAlert helper rows from other kinds do not affect deal dedupe', async () => {
  const db = openDb(':memory:')
  insertAlert({ db, itemId: 'k7', kind: 'test', sentAt: NOW.toISOString(), delivered: true })
  const result = await runItem({
    item: withoutHeartbeat(), now: NOW, db, deps: makeDeps()
  })
  assert.ok(result.messages.deal)
})

test('a fake Bunnings listing sends a low-priority check notice with no listing action',
  async () => {
  const db = openDb(':memory:')
  const fake = listing({ price: 9, effectivePrice: 9, url: 'https://evil.example/k7' })
  const deps = makeDeps({ listings: [fake] })
  const result = await runItem({ item: withoutHeartbeat(), now: NOW, db, deps })
  assert.equal(result.messages.deal, null)
  const [sent] = deps.calls.deliver
  const [alert] = recentAlerts({ db, limit: 1 })
  assert.equal(deps.calls.deliver.length, 1)
  assert.equal(sent.priority, 2)
  assert.equal(sent.actions, undefined)
  assert.equal(sent.click, `http://localhost:4280/#/item/k7/alert/${alert.id}`)
  assert.match(sent.message, /Site: evil\.example/)
  assert.deepEqual([alert.kind, alert.url], ['check', 'https://evil.example/k7'])
  assert.equal(lastAlertsFor({ db, itemId: 'k7' }).size, 0)
  const again = makeDeps({ listings: [fake] })
  await runItem({ item: withoutHeartbeat(), now: NOW, db, deps: again })
  assert.equal(again.calls.deliver.length, 0)
  const real = makeDeps()
  await runItem({ item: withoutHeartbeat(), now: NOW, db, deps: real })
  assert.equal(real.calls.deliver[0].priority, 4)
})

const directEntry = (overrides = {}) => ({
  retailer: 'Tool Kit Depot',
  url: 'https://www.bunnings.com.au/k7',
  category: 'smart',
  parser: 'jsonld',
  ...overrides
})

const directItem = (overrides = {}) => withoutHeartbeat({
  direct: [directEntry()],
  directSchedules: [{ cron: '30 9 * * *', tz: 'Australia/Sydney' }],
  ...overrides
})

const makeDirectDeps = (options = {}) => {
  const base = makeDeps(options)
  const { calls } = base
  calls.direct = 0
  return {
    ...base,
    direct: async () => {
      calls.direct += 1
      return researchResult(options.listings ?? [listing()])
    }
  }
}

const succeedRun = ({ db, startedAt, mode }) => {
  const runId = startRun({ db, itemId: 'k7', trigger: 'tick', startedAt, mode })
  finishRun({ db, runId, status: 'ok', finishedAt: startedAt })
}

test('direct run records listings with mode direct and can alert', async () => {
  const db = openDb(':memory:')
  const deps = makeDirectDeps()
  const result = await runItem({
    item: directItem(), mode: 'direct', now: NOW, db, deps
  })
  assert.equal(result.status, 'ok')
  assert.equal(deps.calls.direct, 1)
  assert.equal(deps.calls.research, 0)
  const [run] = recentRuns({ db, itemId: 'k7' })
  assert.equal(run.mode, 'direct')
  assert.equal(run.listingCount, 1)
  assert.equal(runListings({ db, runId: result.runId })[0].qualifies, true)
  assert.equal(deps.calls.deliver.length, 1)
  assert.equal(recentAlerts({ db, limit: 5 })[0].kind, 'deal')
})

test('direct run never sends the monthly heartbeat', async () => {
  const db = openDb(':memory:')
  const deps = makeDirectDeps({ listings: [listing({ price: 5000, effectivePrice: 5000 })] })
  await runItem({
    item: directItem({ heartbeat: { monthly: true } }), mode: 'direct', now: NOW, db, deps
  })
  assert.deepEqual(kinds(db), [])
})

test('failed direct run is recorded as failed with the collector errors', async () => {
  const db = openDb(':memory:')
  const deps = { ...makeDirectDeps(), direct: async () => ({ ok: false, errors: ['all errored'] }) }
  const result = await runItem({ item: directItem(), mode: 'direct', now: NOW, db, deps })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /all errored/)
})

test('direct dry run stores no listings and no alerts', async () => {
  const db = openDb(':memory:')
  const deps = makeDirectDeps()
  const result = await runItem({
    item: directItem(), mode: 'direct', dryRun: true, now: NOW, db, deps
  })
  assert.equal(result.messages.deal.title, 'Karcher K7 deal found')
  assert.equal(recentRuns({ db, itemId: 'k7' })[0].trigger, 'dry-run')
  assert.equal(runListings({ db, runId: result.runId }).length, 0)
  assert.equal(deps.calls.deliver.length, 0)
})

test('tick runs only the direct check when research is fresh and direct is due', async () => {
  const db = openDb(':memory:')
  succeedRun({ db, startedAt: '2026-11-06T23:00:00.000Z', mode: 'research' })
  const deps = makeDirectDeps()
  const outcomes = await tick({
    now: NOW,
    db,
    deps,
    log: () => {},
    items: runnable(directItem()),
    lockPath: await makeLockPath()
  })
  assert.deepEqual(outcomes.map(({ mode, action }) => [mode, action]), [
    ['research', 'not-due'],
    ['direct', 'ran']
  ])
  assert.equal(deps.calls.research, 0)
  assert.equal(deps.calls.direct, 1)
})

test('tick runs only research when direct is fresh and research is due', async () => {
  const db = openDb(':memory:')
  succeedRun({ db, startedAt: '2026-11-06T23:00:00.000Z', mode: 'direct' })
  const deps = makeDirectDeps()
  const outcomes = await tick({
    now: NOW,
    db,
    deps,
    log: () => {},
    items: runnable(directItem()),
    lockPath: await makeLockPath()
  })
  assert.deepEqual(outcomes.map(({ mode, action }) => [mode, action]), [
    ['research', 'ran'],
    ['direct', 'not-due']
  ])
  assert.equal(deps.calls.research, 1)
  assert.equal(deps.calls.direct, 0)
})

test('a failed direct run does not put research on cooldown', async () => {
  const db = openDb(':memory:')
  const failedId = startRun({
    db, itemId: 'k7', trigger: 'tick', startedAt: '2026-11-06T23:30:00.000Z', mode: 'direct'
  })
  finishRun({ db, runId: failedId, status: 'failed', finishedAt: '2026-11-06T23:30:00.000Z' })
  const deps = makeDirectDeps()
  const outcomes = await tick({
    now: NOW,
    db,
    deps,
    log: () => {},
    items: runnable(directItem()),
    lockPath: await makeLockPath()
  })
  assert.deepEqual(outcomes.map(({ mode, action }) => [mode, action]), [
    ['research', 'ran'],
    ['direct', 'skipped-recent-failure']
  ])
})

test('tick ignores direct entries when the item has no directSchedules', async () => {
  const db = openDb(':memory:')
  const deps = makeDirectDeps()
  const outcomes = await tick({
    now: NOW,
    db,
    deps,
    log: () => {},
    items: runnable(directItem({ directSchedules: [] })),
    lockPath: await makeLockPath()
  })
  assert.deepEqual(outcomes.map(({ mode }) => mode), ['research'])
})

const kitItem = () => withoutHeartbeat({
  categories: [{ id: 'sun', description: 'Kit bundle' }, { id: 'smart', description: 'Smart' }],
  rules: { sun: { maxPrice: 1300 }, smart: { maxPrice: 900 } },
  kits: [{
    id: 'kit',
    name: 'Sun kit',
    category: 'sun',
    parts: [{ id: 'main', match: 'smart' }, { id: 'shade', description: 'Shade' }]
  }]
})

test('a complete kit is stored once with source kit and can alert', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({
    listings: [
      listing({ price: 1000, effectivePrice: 1000 }),
      listing({
        retailer: 'Shade Co', title: 'Shade', category: 'accessory', part: 'shade',
        price: 200, effectivePrice: 200, url: 'https://example.com/shade'
      })
    ]
  })
  const result = await runItem({ item: kitItem(), now: NOW, db, deps })
  const stored = runListings({ db, runId: result.runId })
  const kits = stored.filter((row) => row.source === 'kit')
  assert.equal(kits.length, 1)
  assert.equal(kits[0].retailer, 'Kit: Bunnings, Shade Co')
  assert.equal(kits[0].effectivePrice, 1200)
  assert.equal(kits[0].qualifies, true)
  assert.equal(stored.find((row) => row.part === 'shade').category, 'accessory')
  assert.equal(stored.length, 3)
  assert.equal(deps.calls.deliver.length, 1)
  assert.match(deps.calls.deliver[0].message, /Kit: Bunnings, Shade Co/)
})

test('a kit dry run stores no kit listing', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({
    listings: [
      listing(),
      listing({ title: 'Shade', category: 'accessory', part: 'shade', price: 200,
        effectivePrice: 200 })
    ]
  })
  const result = await runItem({ item: kitItem(), now: NOW, db, deps, dryRun: true })
  assert.equal(result.decision.kitListings.length, 1)
  assert.equal(runListings({ db, runId: result.runId }).length, 0)
})

const mutedSmart = () => withoutHeartbeat({
  tuning: {
    categories: {
      smart: { state: 'muted', at: NOW.toISOString(), by: 'test', reason: 'r', notifyBelow: 1100 }
    }
  }
})

test('muted price notice keeps Open listing for a trusted retailer host', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps()
  await runItem({ item: mutedSmart(), now: NOW, db, deps })
  const [sent] = deps.calls.deliver
  assert.equal(sent.actions[0].url, 'https://www.bunnings.com.au/k7')
})

test('muted price notice drops Open listing for an unrecognised host', async () => {
  const db = openDb(':memory:')
  const deps = makeDeps({
    listings: [listing({ retailer: 'Cheap K7', url: 'https://cheap-k7.example/k7' })]
  })
  await runItem({ item: mutedSmart(), now: NOW, db, deps })
  const [sent] = deps.calls.deliver
  assert.ok(sent.click)
  assert.equal(sent.actions, undefined)
})
