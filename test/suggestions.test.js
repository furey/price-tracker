import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryStats, siteStats } from '../src/site-stats.js'
import { localDay, saleEventsFor, saleWindowAt } from '../src/sale-windows.js'
import {
  DISMISSED_REASON, RESTORED_REASON, dismissalRecord, failingEverywhere, isBrandSite, isDealSite,
  isDismissed, latestDismissals, suggestTuning, withGlobalSites
} from '../src/suggestions.js'
import { formatHeartbeatMessage } from '../src/decide.js'
import { buildResearchPrompt } from '../src/draft-prompts.js'
import { mutedSummary } from '../src/tuning.js'

const QUIET_NOW = new Date('2027-02-10T00:00:00.000Z')
const SALE_NOW = new Date('2026-11-20T00:00:00.000Z')
const DAY_MS = 86_400_000
const TKD_URL = 'https://toolkitdepot.com.au/'
  + 'karcher-k7-premium-power-home-pressure-washer-1-317-172-0/'
const stamp = { at: '2027-01-01T00:00:00.000Z', by: 'Alex', reason: 'test' }

const itemConfig = (overrides = {}) => ({
  id: 'karcher-k7',
  name: 'Kärcher K7',
  schedules: [{ cron: '57 7 * * *', tz: 'Australia/Sydney' }],
  categories: [
    { id: 'premium-power-home', description: 'K7 Premium Power Home' },
    { id: 'smart-control-car-home', description: 'K7 Smart Control Car & Home' },
    { id: 'wcm-premium', description: 'K7 WCM Premium' }
  ],
  rules: {
    'premium-power-home': { maxPrice: 950 },
    'smart-control-car-home': { maxPrice: 1100 },
    'wcm-premium': { maxPrice: 950 }
  },
  sources: {
    sites: [
      { name: 'Bunnings' }, { name: 'JB Hi-Fi' }, { name: 'Total Tools' },
      { name: 'Supercheap Auto' }, { name: 'OzBargain' },
      { name: 'Kärcher Australia', url: 'https://www.kaercher.com/au/' },
      { name: 'Tool Kit Depot' }
    ],
    searches: ['Karcher K7'],
    seasonalSearches: []
  },
  direct: [{
    retailer: 'Tool Kit Depot',
    url: TKD_URL,
    category: 'premium-power-home',
    parser: 'jsonld'
  }],
  ...overrides
})

const daysAgo = (now, days) => new Date(now.getTime() - days * DAY_MS).toISOString()

const listing = (overrides = {}) => ({
  retailer: 'Bunnings',
  title: 'Kärcher K7 Premium Power Home',
  category: 'premium-power-home',
  rejectReason: null,
  price: 1099,
  effectivePrice: 1099,
  inStock: true,
  verified: true,
  url: 'https://www.bunnings.com.au/k7-premium-power-home_p0631836',
  notes: '',
  ...overrides
})

const aiRun = ({ id, at, sources, listings = [], qualified = [], mode = 'research' }) => ({
  id,
  mode,
  trigger: 'tick',
  status: 'ok',
  startedAt: at,
  itemVersion: 1,
  costUsd: 1.6,
  research: { checkedAt: at, sources, listings },
  decision: { qualified: qualified.map((entry) => ({ listing: entry, reasons: [] })) }
})

const tkdSource = 'Tool Kit Depot direct karcher-k7-premium-power-home-pressure-washer-1-317-172-0'

const directRun = ({ id, at, status = 'ok', price = 1080 }) => ({
  id,
  mode: 'direct',
  trigger: 'tick',
  status: 'ok',
  startedAt: at,
  itemVersion: 1,
  costUsd: null,
  research: {
    checkedAt: at,
    sources: [{
      name: tkdSource, status, note: status === 'ok' ? '1 JSON-LD offers' : 'HTTP 503'
    }],
    listings: status === 'ok'
      ? [listing({
        retailer: 'Tool Kit Depot', price: price, effectivePrice: price,
        url: TKD_URL
      })]
      : []
  },
  decision: { qualified: [] }
})

const researchRuns = (now, count = 3) => Array.from({ length: count }, (_, index) => aiRun({
  id: index + 1,
  at: daysAgo(now, 2 + index * 3),
  sources: [
    { name: 'Bunnings', status: 'ok', note: 'Found the K7' },
    { name: 'JB Hi-Fi', status: 'blocked', note: 'HTTP 429 Too Many Requests' },
    { name: 'Total Tools', status: 'blocked', note: 'Access denied' },
    { name: 'Supercheap Auto', status: 'ok', note: 'Only K7 Compact' },
    { name: 'OzBargain', status: 'not_found', note: 'No recent deals' },
    { name: 'Kärcher Australia (kaercher.com/au)', status: 'not_found', note: 'Info only' },
    { name: 'Tool Kit Depot', status: 'ok', note: 'Listed' }
  ],
  listings: [
    listing(),
    listing({
      retailer: 'Supercheap Auto', title: 'Kärcher K7 Compact', category: 'reject',
      rejectReason: 'K7 Compact is excluded', url: 'https://www.supercheapauto.com.au/k7-compact'
    }),
    listing({
      retailer: 'Tool Kit Depot', price: 1080, effectivePrice: 1080,
      url: TKD_URL
    })
  ]
}))

const manualRun = (now) => aiRun({
  id: 50,
  mode: 'manual',
  at: daysAgo(now, 1),
  sources: [
    { name: 'Total Tools', status: 'ok', note: 'Checked in Chrome' },
    { name: 'JB Hi-Fi', status: 'not_found', note: 'Checked in Chrome; no K7' }
  ]
})

const ids = (list) => list.map(({ id }) => id).sort()

test('siteStats counts statuses, manual checks, eligible listings, and alerts per site', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [...researchRuns(now), manualRun(now)]
  const alerts = [{ id: 6, kind: 'deal', sentAt: daysAgo(now, 3), retailer: 'Bunnings' }]
  const rows = siteStats({ item, runs, alerts, now, days: 30 })
  const row = (name) => rows.find((entry) => entry.name === name)
  assert.deepEqual(row('JB Hi-Fi').statuses, { ok: 0, blocked: 3, error: 0, not_found: 0 })
  assert.equal(row('JB Hi-Fi').rateLimited, 3)
  assert.deepEqual(row('JB Hi-Fi').manual, { checks: 1, ok: 0, notFound: 1 })
  assert.equal(row('Bunnings').eligible, 3)
  assert.equal(row('Bunnings').alerts, 1)
  assert.equal(row('Supercheap Auto').found, 3)
  assert.equal(row('Supercheap Auto').rejected, 3)
  assert.equal(row('Kärcher Australia').checks, 3)
  assert.equal(row('Total Tools').manual.ok, 1)
  assert.equal(row('Bunnings').recent.length, 3)
  assert.equal(row('Bunnings').recent[0].at, daysAgo(now, 2))
})

test('siteStats ignores runs outside the window and listings from an untrusted host', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [
    aiRun({
      id: 1,
      at: daysAgo(now, 45),
      sources: [{ name: 'Bunnings', status: 'ok', note: '' }],
      listings: [listing()]
    }),
    aiRun({
      id: 2,
      at: daysAgo(now, 5),
      sources: [{ name: 'Bunnings', status: 'ok', note: '' }],
      listings: [listing({ url: 'https://bunnings-deals.example.net/k7' })]
    })
  ]
  const thirty = siteStats({ item, runs, now, days: 30 }).find(({ name }) => name === 'Bunnings')
  const ninety = siteStats({ item, runs, now, days: 90 }).find(({ name }) => name === 'Bunnings')
  assert.equal(thirty.checks, 1)
  assert.equal(thirty.found, 1)
  assert.equal(thirty.eligible, 0)
  assert.equal(ninety.checks, 2)
  assert.equal(ninety.eligible, 1)
  assert.equal(ninety.lastUseful, daysAgo(now, 45))
})

test('siteStats gives free checks their own rows and marks muted sites', () => {
  const now = QUIET_NOW
  const item = itemConfig({ tuning: { sites: { 'JB Hi-Fi': { state: 'muted', ...stamp } } } })
  const runs = [directRun({ id: 1, at: daysAgo(now, 1) }), directRun({
    id: 2, at: daysAgo(now, 2), status: 'error'
  })]
  const rows = siteStats({ item, runs, now, days: 30 })
  const direct = rows.find(({ kind }) => kind === 'direct')
  assert.equal(direct.checks, 2)
  assert.deepEqual(direct.statuses, { ok: 1, blocked: 0, error: 1, not_found: 0 })
  assert.equal(direct.eligible, 1)
  assert.equal(rows.find(({ name }) => name === 'JB Hi-Fi').state, 'muted')
  assert.equal(rows.find(({ name }) => name === 'JB Hi-Fi').stateSince, stamp.at)
})

test('siteStats links each check to the page tried, else to the configured site url', () => {
  const now = QUIET_NOW
  const tried = 'https://www.bunnings.com.au/search/products?q=k7'
  const runs = [
    aiRun({
      id: 1,
      at: daysAgo(now, 3),
      sources: [
        { name: 'Bunnings', status: 'blocked', note: 'CAPTCHA', url: tried },
        { name: 'Kärcher Australia', status: 'ok', note: '' },
        { name: 'Kogan', status: 'ok', note: '', url: 'https://www.kogan.com/au/k7' }
      ]
    }),
    aiRun({
      id: 2,
      at: daysAgo(now, 1),
      sources: [
        { name: 'Bunnings', status: 'blocked', note: 'CAPTCHA' },
        { name: 'Total Tools', status: 'blocked', note: '', url: 'http://10.0.0.1/' }
      ]
    }),
    directRun({ id: 3, at: daysAgo(now, 2) })
  ]
  const rows = siteStats({ item: itemConfig(), runs, now, days: 30 })
  const row = (name) => rows.find((entry) => entry.name === name)
  assert.deepEqual(row('Bunnings').recent.map(({ url }) => url), [
    'https://bunnings.com.au/', tried
  ])
  assert.deepEqual(row('Bunnings').recent.map(({ urlKind }) => urlKind), ['home', 'page'])
  assert.equal(row('Bunnings').url, tried)
  assert.equal(row('Kärcher Australia').recent[0].url, 'https://www.kaercher.com/au/')
  assert.equal(row('Total Tools').url, 'https://totaltools.com.au/')
  assert.equal(row('Total Tools').urlKind, 'home')
  assert.equal(row('Kogan').url, 'https://www.kogan.com/au/k7')
  const direct = rows.find(({ kind }) => kind === 'direct')
  assert.equal(direct.url, TKD_URL)
  assert.equal(direct.recent[0].url, TKD_URL)
})

test('siteStats drops a configured site url that is not a public address', () => {
  const item = itemConfig({
    sources: { sites: [{ name: 'Router', url: 'http://192.168.1.1/' }], searches: [] }
  })
  const runs = [aiRun({
    id: 1, at: daysAgo(QUIET_NOW, 1), sources: [{ name: 'Router', status: 'error', note: '' }]
  })]
  const [row] = siteStats({ item, runs, now: QUIET_NOW, days: 30 })
  assert.equal(row.url, null)
  assert.equal(row.recent[0].url, null)
})

test('categoryStats finds the lowest eligible price per category and counts AI runs', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = researchRuns(now)
  const stats = categoryStats({ item, runs, now, days: 30 })
  const top = stats.find(({ id }) => id === 'premium-power-home')
  assert.equal(top.sightings, 3)
  assert.equal(top.lowest, 1080)
  assert.equal(top.lowestRetailer, 'Tool Kit Depot')
  assert.equal(stats.find(({ id }) => id === 'wcm-premium').runsWithListings, 0)
})

test('saleEventsFor computes Black Friday, Cyber Monday, and Click Frenzy dates', () => {
  const events = Object.fromEntries(
    saleEventsFor({ year: 2026 }).map(({ name, date }) => [name, date])
  )
  assert.equal(events['Black Friday'], '2026-11-27')
  assert.equal(events['Cyber Monday'], '2026-11-30')
  assert.equal(events['Click Frenzy'], '2026-11-10')
  const blackFriday = saleEventsFor({ year: 2025 }).find(({ name }) => name === 'Black Friday')
  assert.equal(blackFriday.date, '2025-11-28')
})

test('saleWindowAt merges back-to-back windows and includes seasonal searches', () => {
  const item = itemConfig({
    sources: {
      ...itemConfig().sources,
      seasonalSearches: [{ phrase: 'k7 easter', from: '2027-04-01', until: '2027-04-10' }]
    }
  })
  assert.equal(saleWindowAt({ item, today: '2027-02-10' }), null)
  const november = saleWindowAt({ item, today: '2026-11-20' })
  assert.equal(november.until, '2026-12-07')
  assert.ok(november.names.includes('Black Friday'))
  assert.equal(saleWindowAt({ item, today: '2027-04-05' }).until, '2027-04-09')
  assert.equal(saleWindowAt({ item, today: '2027-01-01' }).names[0], 'Boxing Day')
  assert.equal(localDay({ now: new Date('2026-11-08T14:00:00Z') }), '2026-11-09')
})

test('suggestTuning applies the site rules with their evidence', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [
    ...researchRuns(now),
    manualRun(now),
    ...[1, 2, 3].map((index) => directRun({ id: 100 + index, at: daysAgo(now, index) }))
  ]
  const { suggestions, held, waiting } = suggestTuning({ item, runs, now })
  assert.deepEqual(held, [])
  assert.deepEqual(waiting, [])
  const byId = Object.fromEntries(suggestions.map((entry) => [entry.id, entry]))
  assert.deepEqual(byId['S1:site:JB Hi-Fi'].change, { kind: 'mute-site', name: 'JB Hi-Fi' })
  assert.match(byId['S1:site:JB Hi-Fi'].reason, /No eligible listing in 3 AI checks/)
  assert.match(byId['S1:site:JB Hi-Fi'].reason, /Your Chrome check found nothing/)
  assert.deepEqual(byId['S2:site:Total Tools'].change, { kind: 'weekly-site', name: 'Total Tools' })
  assert.deepEqual(byId['S4:site:Supercheap Auto'].change.kind, 'weekly-site')
  assert.match(byId['S4:site:Supercheap Auto'].reason, /found 3 listings, all rejected/)
  assert.ok(byId['S3:site:Tool Kit Depot'])
  assert.equal(byId['C1:category:premium-power-home'].evidence.checks, 6)
  assert.equal(Object.keys(byId).some((id) => id.includes('OzBargain')), false)
  assert.equal(Object.keys(byId).some((id) => id.includes('Kärcher')), false)
  assert.equal(Object.keys(byId).some((id) => id.includes('Bunnings')), false)
})

test('suggestTuning waits for three checks and holds site rules in a sale window', () => {
  const item = itemConfig()
  const early = suggestTuning({ item, runs: researchRuns(QUIET_NOW, 2), now: QUIET_NOW })
  const jb = early.waiting.find(({ id }) => id === 'S1:site:JB Hi-Fi')
  assert.equal(jb.needs, 1)
  assert.equal(early.suggestions.some(({ id }) => id === 'S1:site:JB Hi-Fi'), false)
  const sale = suggestTuning({ item, runs: researchRuns(SALE_NOW), now: SALE_NOW })
  assert.ok(sale.held.some(({ id }) => id === 'S1:site:JB Hi-Fi'))
  assert.equal(sale.suggestions.some(({ change }) => change?.kind === 'mute-site'), false)
  assert.equal(sale.saleWindow.until, '2026-12-07')
})

test('suggestTuning prefers the rate-limit rule over mute when the site had value', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [
    aiRun({
      id: 9,
      at: daysAgo(now, 60),
      sources: [{ name: 'JB Hi-Fi', status: 'ok', note: '' }],
      listings: [listing({ retailer: 'JB Hi-Fi', url: 'https://www.jbhifi.com.au/k7' })]
    }),
    ...researchRuns(now)
  ]
  const { suggestions } = suggestTuning({ item, runs, now })
  const jb = suggestions.find(({ subject }) => subject.key === 'JB Hi-Fi')
  assert.equal(jb.rule, 'S5')
  assert.match(jb.reason, /Rate limited \(HTTP 429\) on 3 of 3 AI checks/)
})

test('suggestTuning suggests reviewing a price that stays over its cap', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [1, 2, 3, 4, 5].map((index) => directRun({ id: index, at: daysAgo(now, index) }))
  const { suggestions } = suggestTuning({ item, runs, now })
  const price = suggestions.find(({ rule }) => rule === 'C1')
  assert.equal(price.action, 'edit-prices')
  assert.equal(price.change, null)
  assert.equal(price.reason, 'The lowest eligible price for premium-power-home was $1,080 '
    + '(Tool Kit Depot) across 5 sightings in 30 days, 14% over its $950 alert price.')
  const close = [1, 2, 3, 4, 5].map((index) => directRun({
    id: index, at: daysAgo(now, index), price: 1040
  }))
  assert.equal(suggestTuning({ item, runs: close, now }).suggestions.length, 0)
})

test('suggestTuning turns off a free check that failed three runs in a row', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [
    directRun({ id: 1, at: daysAgo(now, 4) }),
    ...[1, 2, 3].map((index) => directRun({
      id: 1 + index, at: daysAgo(now, index), status: 'error'
    }))
  ]
  const { suggestions } = suggestTuning({ item, runs, now })
  const off = suggestions.find(({ rule }) => rule === 'D1')
  assert.deepEqual(off.change, { kind: 'disable-direct', url: item.direct[0].url })
  assert.equal(off.reason, 'The free check failed on the last 3 runs (error, error, error).')
})

test('suggestTuning mutes a category from feedback that saved no change', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const alerts = [
    { id: 6, kind: 'deal', sentAt: daysAgo(now, 5), retailer: 'Bunnings', category: 'wcm-premium' },
    { id: 7, kind: 'deal', sentAt: daysAgo(now, 3), retailer: 'Bunnings', category: 'wcm-premium' }
  ]
  const feedback = [
    { id: 1, alertId: 6, reason: 'not-now', changes: null, createdAt: daysAgo(now, 4) },
    { id: 2, alertId: 7, reason: 'not-now', changes: null, createdAt: daysAgo(now, 2) }
  ]
  const { suggestions } = suggestTuning({ item, runs: [], alerts, feedback, now })
  const mute = suggestions.find(({ rule }) => rule === 'C2')
  assert.deepEqual(mute.change, { kind: 'mute-category', id: 'wcm-premium' })
  assert.equal(mute.reason, 'You marked 2 alerts for wcm-premium "Just not now".')
  const acted = feedback.map((row) => ({ ...row, changes: [{ kind: 'mute-category' }] }))
  assert.equal(suggestTuning({ item, runs: [], alerts, feedback: acted, now })
    .suggestions.length, 0)
})

test('suggestTuning asks to keep or remove a category unseen in ten AI runs', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = researchRuns(now, 10).map((run, index) => ({
    ...run, startedAt: daysAgo(now, index + 1)
  }))
  const { suggestions } = suggestTuning({ item, runs, now })
  const quiet = suggestions.filter(({ rule }) => rule === 'C3')
  assert.deepEqual(ids(quiet), ['C3:category:smart-control-car-home', 'C3:category:wcm-premium'])
  assert.equal(quiet[0].action, 'edit-categories')
})

test('a dismissed suggestion returns when its evidence doubles or changes kind', () => {
  const now = QUIET_NOW
  const item = itemConfig()
  const runs = [...researchRuns(now), manualRun(now)]
  const [jb] = suggestTuning({ item, runs, now }).suggestions
    .filter(({ id }) => id === 'S1:site:JB Hi-Fi')
  const dismissedAt = daysAgo(now, 0.5)
  const record = dismissalRecord({
    suggestion: { ...jb, evidence: { ...jb.evidence } }
  })
  assert.deepEqual(record.kinds, ['ai-blocked', 'http-429', 'manual-not-found'])
  const row = { id: 1, reason: DISMISSED_REASON, changes: record, createdAt: dismissedAt, by: 'J' }
  const quiet = suggestTuning({ item, runs, feedback: [row], now })
  assert.equal(quiet.suggestions.some(({ id }) => id === jb.id), false)
  assert.equal(quiet.dismissed[0].dismissal.by, 'J')
  const moreRuns = [0.1, 0.2, 0.3].map((days, index) => aiRun({
    id: 200 + index,
    at: daysAgo(now, days),
    sources: [{ name: 'JB Hi-Fi', status: 'blocked', note: 'HTTP 429' }]
  }))
  const doubled = suggestTuning({ item, runs: [...runs, ...moreRuns], feedback: [row], now })
  assert.ok(doubled.suggestions.some(({ id }) => id === jb.id))
  const permanent = { ...row, changes: { ...record, permanent: true } }
  const kept = suggestTuning({ item, runs: [...runs, ...moreRuns], feedback: [permanent], now })
  assert.equal(kept.suggestions.some(({ id }) => id === jb.id), false)
  const restored = { id: 2, reason: RESTORED_REASON, changes: { suggestionId: jb.id },
    createdAt: daysAgo(now, 0.2) }
  const back = suggestTuning({ item, runs, feedback: [row, restored], now })
  assert.ok(back.suggestions.some(({ id }) => id === jb.id))
})

test('isDismissed expires after 90 days and on a new kind of evidence', () => {
  const now = QUIET_NOW
  const suggestion = { id: 'S1:site:x', evidence: { checks: 3, kinds: ['ai-blocked'], times: [] } }
  const row = (createdAt, kinds = ['ai-blocked']) => ({
    reason: DISMISSED_REASON, createdAt, changes: { checks: 3, kinds }
  })
  assert.equal(isDismissed({ suggestion, dismissal: row(daysAgo(now, 10)), now }), true)
  assert.equal(isDismissed({ suggestion, dismissal: row(daysAgo(now, 91)), now }), false)
  assert.equal(isDismissed({ suggestion, dismissal: row(daysAgo(now, 10), []), now }), false)
  const latest = latestDismissals([
    { id: 2, reason: RESTORED_REASON, createdAt: daysAgo(now, 1), changes: { suggestionId: 'a' } },
    { id: 1, reason: DISMISSED_REASON, createdAt: daysAgo(now, 2), changes: { suggestionId: 'a' } },
    { id: 3, reason: 'not-now', createdAt: daysAgo(now, 1), changes: null }
  ])
  assert.equal(latest.get('a').reason, RESTORED_REASON)
  assert.equal(latest.size, 1)
})

test('withGlobalSites offers a site change on every item only when each item agrees', () => {
  const now = QUIET_NOW
  const k7 = itemConfig()
  const tramp = itemConfig({ id: 'springfree', name: 'Springfree trampoline' })
  const runs = [...researchRuns(now), manualRun(now)]
  const perItem = [k7, tramp].map((item) => ({
    item, result: suggestTuning({ item, runs, now })
  }))
  const [first] = withGlobalSites(perItem)
  const jb = first.result.suggestions.find(({ id }) => id === 'S1:site:JB Hi-Fi')
  assert.deepEqual(jb.alsoOn.map(({ itemId }) => itemId), ['springfree'])
  const lonely = withGlobalSites([perItem[0], {
    item: tramp, result: { ...perItem[1].result, suggestions: [] }
  }])
  assert.deepEqual(lonely[0].result.suggestions.find(({ id }) => id === jb.id).alsoOn, [])
})

test('failingEverywhere lists sites that failed on every item that checked them', () => {
  const row = (name, statuses) => ({
    kind: 'site', name, checks: Object.values(statuses).reduce((a, b) => a + b, 0),
    statuses: { ok: 0, blocked: 0, error: 0, not_found: 0, ...statuses }
  })
  const result = failingEverywhere([
    { item: { id: 'a' }, sites: [row('Amazon.com.au', { blocked: 1, error: 1 }),
      row('Big W', { error: 2 })] },
    { item: { id: 'b' }, sites: [row('Amazon.com.au', { error: 3, blocked: 1 }),
      row('Big W', { error: 3, not_found: 1 })] }
  ])
  assert.deepEqual(result, [{ name: 'Amazon.com.au', items: ['a', 'b'], checks: 6 }])
})

test('deal and brand sites are recognised', () => {
  assert.equal(isDealSite('OzBargain'), true)
  assert.equal(isDealSite('BuyWisely'), true)
  assert.equal(isDealSite('Bunnings'), false)
  const item = { name: 'Kärcher K7' }
  assert.equal(isBrandSite({ item, site: { name: 'Kärcher Australia' } }), true)
  assert.equal(isBrandSite({
    item: { name: 'Springfree medium oval' },
    site: { name: 'Official store', url: 'https://www.springfree.com.au/' }
  }), true)
  assert.equal(isBrandSite({ item, site: { name: 'Bunnings' } }), false)
})

test('the heartbeat lists muted and weekly counts', () => {
  const item = itemConfig({
    tuning: {
      categories: { 'wcm-premium': { state: 'muted', ...stamp } },
      sites: {
        'JB Hi-Fi': { state: 'muted', ...stamp },
        'Total Tools': { state: 'weekly', ...stamp }
      }
    }
  })
  assert.equal(mutedSummary(item), 'Muted: 1 model, 1 site. Checked weekly: 1 site')
  assert.equal(mutedSummary(itemConfig()), null)
  const message = formatHeartbeatMessage({
    item, lowest: null, failedSources: [], qualifiedCount: 0
  }).message
  assert.match(message, /Muted: 1 model, 1 site\. Checked weekly: 1 site$/)
})

test('the wizard research prompt names sites that failed everywhere', () => {
  const base = {
    input: { description: 'A trampoline' }, rounds: [], delivery: null, today: '2026-11-09',
    endDate: null, questionsAllowed: false
  }
  const prompt = buildResearchPrompt({
    ...base, failingSites: ['Amazon.com.au', 'Big W <script>']
  })
  assert.match(prompt, /every existing item: Amazon\.com\.au, Big W script\. Leave them out/)
  assert.doesNotMatch(buildResearchPrompt(base), /every existing item/)
})
