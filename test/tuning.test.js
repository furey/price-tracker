import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide } from '../src/decide.js'
import { checkDirect } from '../src/direct.js'
import { buildInsights } from '../src/insights.js'
import { buildPrompt } from '../src/research.js'
import {
  applyTuning, applyTuningChanges, matchesNeverRule, partNumberIn, priceAlertCandidates,
  promptSites, pruneTuning, restoreVersionConfig, suggestedNotifyBelow, TuningError
} from '../src/tuning.js'
import { validateItem } from '../src/item-validate.js'
import { headlinePrices } from '../src/item-trend.js'

const AT = '2026-11-08T10:20:00.000Z'
const NOW = new Date(AT)

const baseItem = (overrides = {}) => ({
  id: 'k7',
  name: 'Karcher K7',
  product: 'A K7 with a hose reel',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'k7-topic' },
  categories: [
    { id: 'premium-power-home', description: 'Premium Power Home' },
    { id: 'smart-control', description: 'Smart Control' },
    { id: 'wcm-premium', description: 'WCM Premium' }
  ],
  rules: {
    'premium-power-home': { maxPrice: 950 },
    'smart-control': { maxPrice: 1100 },
    'wcm-premium': { maxPrice: 950 }
  },
  sources: {
    sites: [{ name: 'Bunnings' }, { name: 'JB Hi-Fi' }, { name: 'Total Tools' }],
    searches: ['karcher k7 premium', 'karcher k7 wcm'],
    seasonalSearches: [{ phrase: 'k7 black friday', from: '2026-11-20', until: '2026-12-02' }]
  },
  direct: [{
    retailer: 'Tool Kit Depot',
    url: 'https://toolkitdepot.example/k7',
    category: 'premium-power-home',
    parser: 'jsonld'
  }],
  directSchedules: [{ cron: '30 7 * * *', tz: 'Australia/Sydney' }],
  dedupe: { minDrop: 25 },
  ...overrides
})

const stamp = { at: AT, by: 'Alex', reason: 'Not the model I want' }

const mutedWcm = (entry = {}) => baseItem({
  tuning: { categories: { 'wcm-premium': { state: 'muted', ...stamp, ...entry } } }
})

const listing = (overrides = {}) => ({
  retailer: 'Bunnings',
  title: 'Karcher K7 WCM Premium Home 1.317-401.0',
  category: 'wcm-premium',
  rejectReason: null,
  price: 799.9,
  wasPrice: null,
  effectivePrice: 799.9,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://www.bunnings.example/k7-wcm?colour=yellow',
  evidence: '$799.90',
  notes: '',
  ...overrides
})

test('validateItem accepts a full tuning block', () => {
  const item = baseItem({
    tuning: {
      categories: { 'wcm-premium': { state: 'muted', ...stamp, notifyBelow: 650 } },
      sites: { 'JB Hi-Fi': { state: 'muted', ...stamp }, Bunnings: { state: 'weekly', ...stamp } },
      searches: { 'k7 black friday': { state: 'muted', ...stamp } },
      direct: { 'https://toolkitdepot.example/k7': { state: 'off', ...stamp } },
      never: [{
        id: 'wcm', label: 'K7 WCM Premium', match: { partNumber: '1.317-401.0' }, ...stamp
      }]
    }
  })
  assert.deepEqual(validateItem(item), [])
})

test('validateItem rejects unknown keys, bad states, long names, and muting everything', () => {
  const errors = validateItem(baseItem({
    tuning: {
      extra: {},
      categories: {
        'premium-power-home': { state: 'muted', ...stamp },
        'smart-control': { state: 'muted', ...stamp },
        'wcm-premium': { state: 'muted', ...stamp, by: 'x'.repeat(41) },
        nope: { state: 'muted', ...stamp }
      },
      sites: { Myer: { state: 'muted', ...stamp }, Bunnings: { state: 'off', ...stamp } },
      direct: { 'https://toolkitdepot.example/k7': { state: 'off', ...stamp, notifyBelow: 9 } },
      never: [
        { id: 'a', label: 'A', match: {}, ...stamp },
        { id: 'a', label: '', match: { titleWords: [] }, at: 'soon', by: 'Alex' }
      ]
    }
  }))
  const expected = [
    'tuning.extra: not a tuning section',
    'tuning.categories.wcm-premium.by: expected a name of 1 to 40 characters',
    'tuning.categories.nope: not a category id',
    'tuning.categories: keep at least one category unmuted (pause the item instead)',
    'tuning.sites.Myer: not a site name in sources.sites',
    'tuning.sites.Bunnings.state: expected muted or weekly',
    'tuning.direct.https://toolkitdepot.example/k7.notifyBelow: only categories and never rules '
      + 'take a price',
    'tuning.never[0].match: set at least one of url, partNumber, titleWords, retailer',
    'tuning.never[1].id: duplicate',
    'tuning.never[1].label: expected a non-empty string',
    'tuning.never[1].match.titleWords: expected 1 to 8 non-empty words',
    'tuning.never[1].at: expected an ISO date and time'
  ]
  expected.forEach((error) => assert.ok(errors.includes(error), `missing: ${error}`))
})

test('applyTuningChanges stamps who, when, and why, and removes empty sections on restore', () => {
  const muted = applyTuningChanges({
    config: baseItem(),
    changes: [
      { kind: 'mute-category', id: 'wcm-premium', notifyBelow: 650 },
      { kind: 'weekly-site', name: 'Total Tools' },
      { kind: 'never', rule: { label: 'K7 WCM Premium', match: { partNumber: ' 1.317-401.0 ' } } }
    ],
    by: '  Alex  ',
    reason: 'Not the model I want',
    at: AT
  })
  assert.deepEqual(muted.tuning.categories['wcm-premium'], {
    state: 'muted', at: AT, by: 'Alex', reason: 'Not the model I want', notifyBelow: 650
  })
  assert.equal(muted.tuning.sites['Total Tools'].state, 'weekly')
  assert.deepEqual(muted.tuning.never[0].match, { partNumber: '1.317-401.0' })
  assert.equal(muted.tuning.never[0].id, 'k7-wcm-premium')
  assert.deepEqual(validateItem(muted), [])
  const restored = applyTuningChanges({
    config: muted,
    changes: [
      { kind: 'unmute-category', id: 'wcm-premium' },
      { kind: 'restore-site', name: 'Total Tools' },
      { kind: 'restore-never', id: 'k7-wcm-premium' }
    ],
    by: 'Sam',
    at: AT
  })
  assert.equal(restored.tuning, undefined)
  assert.throws(() => applyTuningChanges({
    config: baseItem(), changes: [{ kind: 'mute-site', name: 'Myer' }], by: 'Alex', at: AT
  }), TuningError)
  assert.throws(() => applyTuningChanges({
    config: baseItem(), changes: [{ kind: 'mute-site', name: 'Bunnings' }], by: ' ', at: AT
  }), /by: say who/)
})

test('pruneTuning drops entries whose site, phrase, category, or URL is gone', () => {
  const config = baseItem({
    sources: { sites: [{ name: 'Bunnings' }], searches: ['karcher k7 premium'] },
    tuning: {
      sites: { 'JB Hi-Fi': { state: 'muted', ...stamp }, Bunnings: { state: 'weekly', ...stamp } },
      searches: { 'karcher k7 wcm': { state: 'muted', ...stamp } }
    }
  })
  assert.deepEqual(pruneTuning(config).tuning, {
    sites: { Bunnings: { state: 'weekly', ...stamp } }
  })
})

test('restoreVersionConfig keeps the current tuning unless asked to restore the old one', () => {
  const oldConfig = baseItem({
    rules: { ...baseItem().rules, 'wcm-premium': { maxPrice: 1000 } },
    tuning: { sites: { Bunnings: { state: 'muted', ...stamp } } }
  })
  const currentConfig = mutedWcm()
  const kept = restoreVersionConfig({ oldConfig, currentConfig })
  assert.equal(kept.rules['wcm-premium'].maxPrice, 1000)
  assert.deepEqual(kept.tuning, currentConfig.tuning)
  const old = restoreVersionConfig({ oldConfig, currentConfig, restoreTuning: true })
  assert.deepEqual(old.tuning, oldConfig.tuning)
  const untuned = restoreVersionConfig({ oldConfig: baseItem(), currentConfig: baseItem() })
  assert.equal('tuning' in untuned, false)
})

test('never rules match by URL, part number, title words, and narrow by retailer', () => {
  const byUrl = { match: { url: 'https://WWW.bunnings.example/k7-wcm/' } }
  const byPart = { match: { partNumber: '1.317-401.0' } }
  const byWords = { match: { titleWords: ['water cooled'] } }
  const tradeOnly = { match: { titleWords: ['wcm'], retailer: 'Bunnings Trade' } }
  assert.equal(matchesNeverRule({ rule: byUrl, listing: listing() }), true)
  assert.equal(matchesNeverRule({ rule: byPart, listing: listing() }), true)
  assert.equal(matchesNeverRule({
    rule: byPart, listing: listing({ title: 'K7 WCM', evidence: 'Part 1.317 - 401.0' })
  }), true)
  assert.equal(matchesNeverRule({
    rule: byPart, listing: listing({ title: 'K7 WCM', evidence: 'Part 1.317-402.0' })
  }), false)
  assert.equal(matchesNeverRule({
    rule: byWords, listing: listing({ title: 'Kärcher K7 Water-Cooled Motor' })
  }), true)
  assert.equal(matchesNeverRule({ rule: byWords, listing: listing() }), false)
  assert.equal(matchesNeverRule({ rule: tradeOnly, listing: listing() }), false)
  assert.equal(matchesNeverRule({
    rule: tradeOnly, listing: listing({ retailer: 'bunnings trade' })
  }), true)
  assert.equal(partNumberIn('Kärcher K7 WCM Premium (1.317-401.0) Home'), '1.317-401.0')
  assert.equal(partNumberIn('Kärcher K7 Premium'), null)
  assert.equal(suggestedNotifyBelow({ maxPrice: 950 }), 670)
})

test('decide never qualifies a muted category or a never-show product, but records them', () => {
  const research = {
    sources: [],
    listings: [
      listing(),
      listing({ category: 'premium-power-home', title: 'K7 Water Cooled', price: 899,
        effectivePrice: 899, url: 'https://totaltools.example/k7' }),
      listing({ category: 'smart-control', title: 'K7 Smart Control', price: 1080,
        effectivePrice: 1080, url: 'https://www.bunnings.com.au/sc' })
    ]
  }
  const item = {
    ...mutedWcm(),
    tuning: {
      ...mutedWcm().tuning,
      never: [{ id: 'water', label: 'Water cooled', match: { titleWords: ['water', 'cooled'] },
        ...stamp }]
    }
  }
  const decision = decide({ item, research, lastAlerts: new Map() })
  assert.equal(decision.best.listing.category, 'smart-control')
  assert.deepEqual(decision.qualified.map(({ listing: entry }) => entry.category),
    ['smart-control'])
  assert.deepEqual(decision.muted.map(({ tuned }) => tuned).sort(),
    ['category:wcm-premium', 'never:water'])
  assert.equal(decision.mutedNotice, null)
  const tuned = applyTuning({ item, listings: research.listings })
  assert.match(tuned[1].rejectReason, /You rejected this product \(rule "Water cooled"/)
  assert.equal(tuned[1].category, 'premium-power-home')
})

test('a muted category alone sends no deal even when it is the only listing under its cap', () => {
  const decision = decide({
    item: mutedWcm(), research: { sources: [], listings: [listing()] }, lastAlerts: new Map()
  })
  assert.equal(decision.best, null)
  assert.equal(decision.lowest, null)
})

test('the drops-below price alert sends once per drop, deduped like deals', () => {
  const item = mutedWcm({ notifyBelow: 650 })
  const cheap = listing({ price: 640, effectivePrice: 640 })
  const first = decide({ item, research: { listings: [listing(), cheap] }, lastAlerts: new Map() })
  assert.equal(first.best, null)
  assert.equal(first.mutedNotice.listing.effectivePrice, 640)
  assert.equal(first.mutedNotice.kind, 'category')
  assert.equal(first.mutedNotice.limit, 650)
  const lastMutedAlerts = new Map([
    ['bunnings|category:wcm-premium', { effectivePrice: 640, sentAt: AT }]
  ])
  const again = decide({ item, research: { listings: [cheap] }, lastAlerts: new Map(),
    lastMutedAlerts })
  assert.equal(again.mutedNotice, null)
  const smallDrop = listing({ price: 620, effectivePrice: 620 })
  assert.equal(decide({ item, research: { listings: [smallDrop] }, lastAlerts: new Map(),
    lastMutedAlerts }).mutedNotice, null)
  const bigDrop = listing({ price: 600, effectivePrice: 600 })
  assert.equal(decide({ item, research: { listings: [bigDrop] }, lastAlerts: new Map(),
    lastMutedAlerts }).mutedNotice.listing.effectivePrice, 600)
  const optedOut = decide({
    item: mutedWcm(), research: { listings: [cheap] }, lastAlerts: new Map()
  })
  assert.equal(optedOut.mutedNotice, null)
})

test('a never rule price alert works even when the AI rejected the listing', () => {
  const item = baseItem({
    tuning: { never: [{ id: 'wcm', label: 'K7 WCM', match: { partNumber: '1.317-401.0' },
      notifyBelow: 700, ...stamp }] }
  })
  const rejected = listing({ category: 'reject', rejectReason: 'Buyer rejected this product',
    price: 690, effectivePrice: 690 })
  const tuned = applyTuning({ item, listings: [rejected] })
  const [candidate] = priceAlertCandidates({ item, listings: tuned })
  assert.equal(candidate.kind, 'never')
  assert.equal(candidate.listing.tuned, 'never:wcm')
})

test('buildPrompt marks muted categories, lists never rules, and filters sites and phrases', () => {
  const item = baseItem({
    tuning: {
      categories: { 'wcm-premium': { state: 'muted', ...stamp } },
      sites: { 'JB Hi-Fi': { state: 'muted', ...stamp }, 'Total Tools': { state: 'weekly',
        ...stamp } },
      searches: { 'karcher k7 wcm': { state: 'muted', ...stamp } },
      never: [{ id: 'wcm', label: 'K7 WCM Premium', match: { partNumber: '1.317-401.0' },
        ...stamp }]
    }
  })
  const due = buildPrompt({ item, now: NOW, recentSites: [] })
  assert.match(due, /- wcm-premium: WCM Premium \(muted: do not target\)/)
  assert.match(due, /Muted by the buyer \(do not target these/)
  assert.doesNotMatch(due, /^- wcm-premium: WCM Premium$/m)
  assert.match(due,
    /NOT WANTED\n.*\n- K7 WCM Premium \(part 1\.317-401\.0\): the buyer rejected it/)
  assert.doesNotMatch(due, /- JB Hi-Fi/)
  assert.match(due, /- Total Tools/)
  assert.match(due, /- karcher k7 premium/)
  assert.doesNotMatch(due, /- karcher k7 wcm/)
  const notDue = buildPrompt({ item, now: NOW, recentSites: ['total tools'] })
  assert.doesNotMatch(notDue, /- Total Tools/)
  const saleDay = new Date('2026-11-25T00:00:00.000Z')
  assert.match(buildPrompt({ item, now: saleDay, recentSites: ['Total Tools'] }),
    /- Total Tools/)
  const plain = buildPrompt({ item: baseItem(), now: NOW })
  assert.doesNotMatch(plain, /NOT WANTED|Muted by the buyer/)
})

test('promptSites leaves out muted sites and keeps weekly sites only when due', () => {
  const item = baseItem({
    tuning: { sites: { Bunnings: { state: 'weekly', ...stamp }, 'JB Hi-Fi': { state: 'muted',
      ...stamp } } }
  })
  assert.deepEqual(promptSites({ item, recentSites: ['Bunnings'], today: '2026-11-08' })
    .map(({ name }) => name), ['Total Tools'])
  assert.deepEqual(promptSites({ item, recentSites: [], today: '2026-11-08' })
    .map(({ name }) => name), ['Bunnings', 'Total Tools'])
})

test('checkDirect skips free check URLs that are turned off', async () => {
  const fetched = []
  const fetchImpl = async (url) => {
    fetched.push(url)
    return { status: 200, ok: true, text: async () => '<html></html>' }
  }
  const item = baseItem({
    direct: [
      ...baseItem().direct,
      { retailer: 'Myer', url: 'https://myer.example/k7', category: 'smart-control',
        parser: 'jsonld' }
    ],
    tuning: { direct: { 'https://toolkitdepot.example/k7': { state: 'off', ...stamp } } }
  })
  const data = await checkDirect({ item, fetchImpl, now: NOW, pauseMs: 0 })
  assert.deepEqual(fetched, ['https://myer.example/k7'])
  assert.equal(data.sources.length, 1)
  assert.match(data.sources[0].name, /^Myer/)
})

const row = (overrides = {}) => ({
  checkedAt: '2026-11-07T21:00:00.000Z',
  retailer: 'Bunnings',
  title: 'K7 WCM Premium',
  category: 'wcm-premium',
  effectivePrice: 799.9,
  inStock: true,
  verified: true,
  source: 'research',
  ...overrides
})

test('headlinePrices uses one category for the price and the trend, skipping muted data', () => {
  const rows = [
    row(),
    row({ checkedAt: '2026-11-06T21:00:00.000Z', effectivePrice: 899 }),
    row({ category: 'smart-control', retailer: 'Total Tools', effectivePrice: 1199 }),
    row({ category: 'premium-power-home', retailer: 'Tool Kit Depot', effectivePrice: 1080 }),
    row({ category: 'premium-power-home', retailer: 'Tool Kit Depot', effectivePrice: 1090,
      checkedAt: '2026-11-06T21:00:00.000Z' }),
    row({ category: 'premium-power-home', retailer: 'Bunnings', title: 'K7 Water Cooled',
      effectivePrice: 850 })
  ]
  const untuned = headlinePrices({ rows, item: baseItem() })
  assert.equal(untuned.lowestRecent.effectivePrice, 850)
  const item = {
    ...mutedWcm(),
    tuning: { ...mutedWcm().tuning, never: [{ id: 'water', label: 'Water cooled',
      match: { titleWords: ['water', 'cooled'] }, ...stamp }] }
  }
  const tuned = headlinePrices({ rows, item })
  assert.equal(tuned.lowestRecent.category, 'premium-power-home')
  assert.equal(tuned.lowestRecent.effectivePrice, 1080)
  assert.equal(tuned.trend.category, 'premium-power-home')
  assert.deepEqual(tuned.trend.days.map(({ lowest }) => lowest), [1090, 1080])
  const onlyMuted = headlinePrices({ rows: [row()], item: mutedWcm() })
  assert.deepEqual(onlyMuted, { lowestRecent: null, trend: null })
})

test('buildInsights keeps muted rows apart and flags them for the Show muted switch', () => {
  const rows = [
    row(),
    row({ category: 'premium-power-home', retailer: 'Tool Kit Depot', effectivePrice: 1080 })
  ]
  const insights = buildInsights({ rows, item: mutedWcm(), now: NOW })
  assert.equal(insights.mutedCount, 1)
  assert.deepEqual(insights.series.map(({ category, muted }) => [category, Boolean(muted)]),
    [['premium-power-home', false], ['wcm-premium', true]])
  assert.deepEqual(insights.bestDays.map(({ category }) => category), ['premium-power-home'])
  assert.deepEqual(insights.retailers.filter(({ muted }) => muted).map(({ retailer }) => retailer),
    ['Bunnings'])
})
