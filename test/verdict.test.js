import assert from 'node:assert/strict'
import { test } from 'node:test'
import { itemVerdict, targetPrice } from '../src/verdict.js'

const now = new Date('2026-11-10T06:00:00Z')

const item = {
  categories: [{ id: 'sun-bundle' }, { id: 'bundle' }, { id: 'base' }],
  rules: {
    'sun-bundle': { maxPrice: 1950, rrp: 2456, minPctBelowRrp: 20 },
    bundle: { maxPrice: 1750 },
    base: { maxPrice: 1600, rrp: 1999 }
  }
}

const row = (retailer, category, latest, extra = {}) => ({
  retailer, category, latest, lastSeen: '2026-11-09T20:00:00Z', url: `https://x.au/${retailer}`,
  ...extra
})

const retailers = [
  row('Springfree', 'sun-bundle', 2256),
  row('Springfree', 'bundle', 2186),
  row('Harvey Norman', 'base', 1798),
  row('Temple & Webster', 'base', 1769)
]

test('targetPrice takes the higher of the cap and the RRP target', () => {
  assert.equal(targetPrice({ rule: item.rules.base }), 1600)
  assert.equal(Math.round(targetPrice({ rule: item.rules['sun-bundle'] })), 1965)
  assert.equal(targetPrice({ rule: { maxPrice: 1100, maxPriceIfClearance: 900 },
    isClearance: true }), 900)
  assert.equal(targetPrice({ rule: { maxPrice: null } }), null)
  assert.equal(targetPrice({ rule: undefined }), null)
})

test('itemVerdict picks the category closest to its target', () => {
  const verdict = itemVerdict({ item, retailers, now })
  assert.equal(verdict.kind, 'gap')
  assert.equal(verdict.category, 'base')
  assert.equal(verdict.retailer, 'Temple & Webster')
  assert.equal(verdict.price, 1769)
  assert.equal(verdict.target, 1600)
  assert.equal(verdict.gap, 169)
})

test('itemVerdict never picks a muted category or muted rows', () => {
  const muted = { ...item, tuning: { categories: { base: { state: 'muted' } } } }
  assert.equal(itemVerdict({ item: muted, retailers, now }).category, 'sun-bundle')
  const rows = retailers.map((entry) => (entry.category === 'base' ? { ...entry, muted: true }
    : entry))
  assert.equal(itemVerdict({ item, retailers: rows, now }).category, 'sun-bundle')
})

test('itemVerdict ignores prices older than a week', () => {
  const stale = [row('Bunnings', 'base', 1500, { lastSeen: '2026-10-01T00:00:00Z' })]
  assert.deepEqual(itemVerdict({ item, retailers: stale, now }), { kind: 'none' })
})

test('a live deal window wins, in category order', () => {
  const window = (category, lowest) => ({
    live: true, category, retailer: 'Myer', lowest, startDay: '2026-11-09',
    best: { effectivePrice: lowest, url: 'https://myer.com.au/p' }
  })
  const verdict = itemVerdict({
    item, retailers, now,
    dealWindows: [window('base', 1500), window('bundle', 1700), { ...window('base', 1400),
      live: false }]
  })
  assert.deepEqual(verdict, {
    kind: 'deal', live: true, category: 'bundle', retailer: 'Myer', price: 1700,
    url: 'https://myer.com.au/p', since: '2026-11-09'
  })
})

test('a recent price under target is a deal even without a live window', () => {
  const verdict = itemVerdict({ item, retailers: [row('Myer', 'base', 1590)], now })
  assert.equal(verdict.kind, 'deal')
  assert.equal(verdict.live, false)
})

test('itemVerdict shows the cheapest price when no category has a rule', () => {
  const bare = { categories: item.categories, rules: {} }
  const verdict = itemVerdict({ item: bare, retailers, now })
  assert.equal(verdict.kind, 'no-rule')
  assert.equal(verdict.price, 1769)
})
