import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide } from '../src/decide.js'
import { buildInsights } from '../src/insights.js'
import { kitListing, kitListings, kitPartIds, kitPrice } from '../src/kits.js'

const kit = {
  id: 'sun-kit',
  name: 'Sun Bundle kit',
  category: 'sun-bundle',
  parts: [
    { id: 'trampoline', match: 'base' },
    { id: 'sunshade', name: 'Sunshade', description: 'Medium Oval sunshade' },
    { id: 'flexrstep', name: 'FlexrStep', description: 'FlexrStep' },
    { id: 'wheels', name: 'Wheels', description: 'Shifting Wheels' }
  ]
}

const makeListing = (overrides = {}) => ({
  retailer: 'Springfree',
  title: 'Item',
  category: 'base',
  part: null,
  price: 1000,
  wasPrice: null,
  effectivePrice: 1000,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://shop.example/item',
  evidence: '',
  notes: '',
  ...overrides
})

const accessory = (part, price, overrides = {}) => makeListing({
  category: 'accessory', part, title: part, price: price, effectivePrice: price,
  url: `https://shop.example/${part}`, ...overrides
})

const completeListings = () => [
  makeListing({ price: 1600, effectivePrice: 1600, url: 'https://shop.example/tramp' }),
  accessory('sunshade', 200),
  accessory('flexrstep', 100),
  accessory('wheels', 50)
]

test('kitPrice sums the cheapest eligible listing per part', () => {
  const listings = [
    ...completeListings(),
    accessory('sunshade', 150, { retailer: 'Other', url: 'https://other.example/shade' }),
    accessory('wheels', 10, { inStock: false }),
    makeListing({ retailer: 'Pricey', price: 1900, effectivePrice: 1900 }),
    makeListing({ category: 'bundle', price: 500, effectivePrice: 500 })
  ]
  const result = kitPrice({ kit, listings })
  assert.equal(result.complete, true)
  assert.equal(result.total, 1600 + 150 + 100 + 50)
  assert.deepEqual(result.retailers, ['Springfree', 'Other'])
  assert.equal(result.chosen.find(({ part }) => part.id === 'sunshade').listing.retailer, 'Other')
})

test('kitPrice reports missing parts and stays incomplete', () => {
  const result = kitPrice({ kit, listings: completeListings().slice(0, 2) })
  assert.equal(result.complete, false)
  assert.deepEqual(result.missing, ['flexrstep', 'wheels'])
  assert.equal(kitListing({ kit, listings: completeListings().slice(0, 2) }), null)
})

test('kitPrice ignores rejects, listings without url, and kit listings', () => {
  const listings = [
    ...completeListings(),
    accessory('wheels', 5, { url: null }),
    accessory('wheels', 5, { category: 'reject' }),
    makeListing({ retailer: 'Kit: Springfree', price: 1, effectivePrice: 1 })
  ]
  assert.equal(kitPrice({ kit, listings }).total, 1950)
})

test('kitPrice counts each retailer delivery once and needs every delivery known', () => {
  const listings = [
    makeListing({ price: 1600, effectivePrice: 1600, deliveryCost: 0 }),
    accessory('sunshade', 200, { deliveryCost: 40 }),
    accessory('flexrstep', 100, { deliveryCost: 25 }),
    accessory('wheels', 50, { deliveryCost: 25, retailer: 'Other' })
  ]
  const result = kitPrice({ kit, listings })
  assert.equal(result.deliveryCost, 40 + 25)
  assert.equal(result.delivered, 1950 + 65)
  const unknown = listings.map((listing) =>
    listing.part === 'wheels' ? { ...listing, deliveryCost: null } : listing)
  const partial = kitPrice({ kit, listings: unknown })
  assert.equal(partial.delivered, null)
  assert.equal(partial.deliveryCost, null)
})

test('kitListing builds a synthetic listing for the kit category', () => {
  const listing = kitListing({ kit, listings: completeListings() })
  assert.equal(listing.retailer, 'Kit: Springfree')
  assert.equal(listing.category, 'sun-bundle')
  assert.equal(listing.title, 'Sun Bundle kit (parts)')
  assert.equal(listing.effectivePrice, 1950)
  assert.equal(listing.verified, true)
  assert.equal(listing.url, 'https://shop.example/tramp')
  assert.match(listing.evidence, /sunshade \$200 at Springfree/)
  assert.match(listing.notes, /wheels: wheels \$50 at Springfree/)
})

test('kitListing is unverified when any part is unverified', () => {
  const listings = completeListings().map((listing) =>
    listing.part === 'wheels' ? { ...listing, verified: false } : listing)
  assert.equal(kitListing({ kit, listings }).verified, false)
})

test('kitListings and kitPartIds read the item kits', () => {
  assert.deepEqual(kitListings({ item: {}, listings: completeListings() }), [])
  assert.equal(kitListings({ item: { kits: [kit] }, listings: completeListings() }).length, 1)
  assert.deepEqual(kitPartIds({ kits: [kit] }), ['trampoline', 'sunshade', 'flexrstep', 'wheels'])
  assert.deepEqual(kitPartIds({}), [])
})

const item = {
  name: 'Springfree',
  kits: [kit],
  categories: [{ id: 'sun-bundle' }, { id: 'bundle' }, { id: 'base' }],
  rules: {
    'sun-bundle': { maxPrice: 1950 },
    bundle: { maxPrice: 1750 },
    base: { maxPrice: 1500 }
  },
  sources: { sites: [{ name: 'Shop', url: 'https://shop.example/' }] },
  dedupe: { minDrop: 25 }
}

const research = (listings) => ({ listings, sources: [] })

test('decide qualifies a kit listing and ranks it first', () => {
  const decision = decide({
    item,
    research: research([
      ...completeListings(),
      makeListing({ category: 'bundle', retailer: 'Bundle Co', price: 1700, url: 'https://b/x',
        effectivePrice: 1700 })
    ]),
    lastAlerts: new Map()
  })
  assert.equal(decision.kitListings.length, 1)
  assert.equal(decision.best.listing.retailer, 'Kit: Springfree')
  assert.equal(decision.best.listing.effectivePrice, 1950)
  assert.deepEqual(decision.best.reasons, ['under $1,950 cap'])
})

test('decide does not qualify a kit over the cap and ignores accessories', () => {
  const dear = completeListings().map((listing) =>
    listing.part === 'wheels' ? { ...listing, price: 80, effectivePrice: 80 } : listing)
  const decision = decide({ item, research: research(dear), lastAlerts: new Map() })
  assert.equal(decision.best, null)
  assert.equal(decision.qualified.some(({ listing }) => listing.category === 'accessory'), false)
  assert.equal(decision.lowest.category, 'base')
})

test('decide suppresses a repeat kit alert through dedupe', () => {
  const lastAlerts = new Map([['kit: springfree|sun-bundle', {
    effectivePrice: 1950, sentAt: '2026-11-01T00:00:00Z'
  }]])
  const decision = decide({ item, research: research(completeListings()), lastAlerts })
  assert.equal(decision.best, null)
  assert.equal(decision.suppressed.length, 1)
})

test('buildInsights compares the kit total with the cheapest sun-bundle listing', () => {
  const stamp = { checkedAt: '2026-11-07T00:00:00.000Z', source: 'direct' }
  const rows = [
    ...completeListings().map((listing) => ({ ...listing, ...stamp })),
    makeListing({
      ...stamp, category: 'sun-bundle', title: 'Sun Bundle', price: 2100,
      effectivePrice: 2100, url: 'https://shop.example/sun-bundle'
    }),
    makeListing({
      ...stamp, source: 'kit', retailer: 'Kit: Springfree', category: 'sun-bundle',
      price: 1950, effectivePrice: 1950
    })
  ]
  const [insight] = buildInsights({ rows, item, now: new Date(stamp.checkedAt) }).kits
  assert.equal(insight.id, 'sun-kit')
  assert.equal(insight.total, 1950)
  assert.equal(insight.parts.length, 4)
  assert.equal(insight.parts[1].name, 'Sunshade')
  assert.equal(insight.vsBundle.bundlePrice, 2100)
  assert.equal(insight.vsBundle.saving, 150)
})

test('buildInsights gives no kits without a complete kit or kit config', () => {
  const rows = completeListings().slice(0, 2).map((listing) => ({
    ...listing, checkedAt: '2026-11-07T00:00:00.000Z', source: 'direct'
  }))
  assert.deepEqual(buildInsights({ rows, item }).kits, [])
  assert.deepEqual(buildInsights({ rows, item: { ...item, kits: undefined } }).kits, [])
})
