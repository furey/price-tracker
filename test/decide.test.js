import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decide,
  dedupeKey,
  eligibleListings,
  formatCheckMessage,
  formatDealMessage,
  formatHeartbeatMessage,
  isImplausiblePrice,
  lowestPerRetailerPerDay,
  passesDedupe,
  qualify,
  rankListings
} from '../src/decide.js'

const makeListing = (overrides = {}) => ({
  retailer: 'Acme',
  title: 'Widget',
  category: 'base',
  rejectReason: null,
  price: 1500,
  wasPrice: null,
  effectivePrice: 1500,
  deliveryCost: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://acme.example/widget',
  evidence: '',
  notes: '',
  ...overrides
})

const categories = [{ id: 'bundle' }, { id: 'base' }]
const item = {
  name: 'Springfree Medium Oval',
  categories,
  rules: {
    bundle: { maxPrice: 1750 },
    base: { maxPrice: 1600, rrp: 1999, minPctBelowRrp: null }
  },
  sources: { sites: [{ name: 'Acme', url: 'https://acme.example/' }] },
  dedupe: { minDrop: 25 }
}

test('eligibleListings drops rejects, out of stock, no url, and no price', () => {
  const listings = [
    makeListing(),
    makeListing({ category: 'reject' }),
    makeListing({ inStock: false }),
    makeListing({ url: null }),
    makeListing({ price: null })
  ]
  assert.equal(eligibleListings(listings).length, 1)
})

test('eligibleListings normalises a null effective price to the price', () => {
  const [listing] = eligibleListings([makeListing({ effectivePrice: null, price: 1400 })])
  assert.equal(listing.effectivePrice, 1400)
})

test('qualify passes at or under maxPrice', () => {
  const result = qualify({
    listing: makeListing({ effectivePrice: 1600 }),
    rule: { maxPrice: 1600 }
  })
  assert.equal(result.qualifies, true)
  assert.deepEqual(result.reasons, ['under $1,600 cap'])
})

test('qualify fails over maxPrice', () => {
  const result = qualify({
    listing: makeListing({ effectivePrice: 1601 }),
    rule: { maxPrice: 1600 }
  })
  assert.equal(result.qualifies, false)
})

test('qualify uses the clearance cap for clearance listings', () => {
  const rule = { maxPrice: 1000, maxPriceIfClearance: 1200 }
  const clearance = makeListing({ isClearance: true, effectivePrice: 1150 })
  const regular = makeListing({ isClearance: false, effectivePrice: 1150 })
  assert.equal(qualify({ listing: clearance, rule }).qualifies, true)
  assert.equal(qualify({ listing: regular, rule }).qualifies, false)
})

test('qualify ignores an unset clearance cap', () => {
  const listing = makeListing({ isClearance: true, effectivePrice: 1100 })
  const rule = { maxPrice: 1000, maxPriceIfClearance: null }
  assert.equal(qualify({ listing, rule }).qualifies, false)
})

test('qualify passes on the RRP percentage rule', () => {
  const rule = { maxPrice: 1000, rrp: 2000, minPctBelowRrp: 20 }
  const result = qualify({ listing: makeListing({ effectivePrice: 1500 }), rule })
  assert.equal(result.qualifies, true)
  assert.deepEqual(result.reasons, ['25% below RRP $2,000'])
})

test('qualify fails when not far enough below RRP', () => {
  const rule = { maxPrice: 1000, rrp: 2000, minPctBelowRrp: 20 }
  assert.equal(
    qualify({ listing: makeListing({ effectivePrice: 1700 }), rule }).qualifies,
    false
  )
})

test('qualify skips the RRP rule when rrp is null', () => {
  const rule = { maxPrice: 1000, rrp: null, minPctBelowRrp: 20 }
  assert.equal(
    qualify({ listing: makeListing({ effectivePrice: 1700 }), rule }).qualifies,
    false
  )
})

test('qualify skips the RRP rule when the percentage is null', () => {
  const rule = { maxPrice: 1000, rrp: 2000, minPctBelowRrp: null }
  assert.equal(
    qualify({ listing: makeListing({ effectivePrice: 1700 }), rule }).qualifies,
    false
  )
})

test('qualify returns both reasons when both rules pass', () => {
  const rule = { maxPrice: 1600, rrp: 2000, minPctBelowRrp: 20 }
  const result = qualify({ listing: makeListing({ effectivePrice: 1500 }), rule })
  assert.equal(result.reasons.length, 2)
})

test('qualify uses the effective price, not the sticker price', () => {
  const listing = makeListing({ price: 1800, effectivePrice: 1550 })
  assert.equal(qualify({ listing, rule: { maxPrice: 1600 } }).qualifies, true)
})

test('qualify fails without a rule', () => {
  assert.equal(qualify({ listing: makeListing(), rule: undefined }).qualifies, false)
})

test('rankListings puts verified before unverified', () => {
  const cheapUnverified = makeListing({ verified: false, effectivePrice: 1000 })
  const dearVerified = makeListing({ verified: true, effectivePrice: 1500 })
  const ranked = rankListings({ listings: [cheapUnverified, dearVerified], categories })
  assert.equal(ranked[0], dearVerified)
})

test('rankListings orders by category preference within verified', () => {
  const base = makeListing({ category: 'base', effectivePrice: 1000 })
  const bundle = makeListing({ category: 'bundle', effectivePrice: 1700 })
  const ranked = rankListings({ listings: [base, bundle], categories })
  assert.equal(ranked[0], bundle)
})

test('rankListings orders by price within category', () => {
  const dear = makeListing({ effectivePrice: 1500 })
  const cheap = makeListing({ effectivePrice: 1400 })
  const ranked = rankListings({ listings: [dear, cheap], categories })
  assert.equal(ranked[0], cheap)
})

test('rankListings does not mutate its input', () => {
  const listings = [
    makeListing({ effectivePrice: 1500 }),
    makeListing({ effectivePrice: 1400 })
  ]
  const copy = [...listings]
  rankListings({ listings, categories })
  assert.deepEqual(listings, copy)
})

test('dedupeKey lowercases and trims the retailer', () => {
  assert.equal(dedupeKey(makeListing({ retailer: '  Harvey Norman ' })), 'harvey norman|base')
})

test('passesDedupe accepts a new retailer', () => {
  const lastAlerts = new Map([['other|base', { effectivePrice: 1500, sentAt: 'x' }]])
  assert.equal(passesDedupe({ listing: makeListing(), lastAlerts, minDrop: 25 }), true)
})

test('passesDedupe accepts a new category for a known retailer', () => {
  const lastAlerts = new Map([['acme|bundle', { effectivePrice: 1500, sentAt: 'x' }]])
  assert.equal(passesDedupe({ listing: makeListing(), lastAlerts, minDrop: 25 }), true)
})

test('passesDedupe suppresses a drop smaller than minDrop', () => {
  const lastAlerts = new Map([['acme|base', { effectivePrice: 1520, sentAt: 'x' }]])
  assert.equal(passesDedupe({ listing: makeListing(), lastAlerts, minDrop: 25 }), false)
})

test('passesDedupe suppresses a drop equal to minDrop', () => {
  const lastAlerts = new Map([['acme|base', { effectivePrice: 1525, sentAt: 'x' }]])
  assert.equal(passesDedupe({ listing: makeListing(), lastAlerts, minDrop: 25 }), false)
})

test('passesDedupe accepts a drop larger than minDrop', () => {
  const lastAlerts = new Map([['acme|base', { effectivePrice: 1526, sentAt: 'x' }]])
  assert.equal(passesDedupe({ listing: makeListing(), lastAlerts, minDrop: 25 }), true)
})

test('passesDedupe accepts a plain object of last alerts', () => {
  const lastAlerts = { 'acme|base': { effectivePrice: 1700, sentAt: 'x' } }
  assert.equal(passesDedupe({ listing: makeListing(), lastAlerts, minDrop: 25 }), true)
})

test('decide picks the best qualified listing', () => {
  const research = {
    sources: [{ name: 'A', status: 'ok' }, { name: 'B', status: 'blocked' }],
    listings: [
      makeListing({ retailer: 'Cheap', category: 'base', effectivePrice: 1400, price: 1400 }),
      makeListing({
        retailer: 'Bundle',
        category: 'bundle',
        effectivePrice: 1700,
        price: 1700
      }),
      makeListing({ retailer: 'Dear', category: 'base', effectivePrice: 1900, price: 1900 }),
      makeListing({ retailer: 'Rej', category: 'reject' })
    ]
  }
  const result = decide({ item, research, lastAlerts: new Map() })
  assert.equal(result.eligible.length, 3)
  assert.equal(result.qualified.length, 2)
  assert.equal(result.best.listing.retailer, 'Bundle')
  assert.deepEqual(result.suppressed, [])
  assert.equal(result.lowest.retailer, 'Cheap')
  assert.deepEqual(result.failedSources.map((source) => source.name), ['B'])
})

test('decide skips a deduped best listing and picks the next', () => {
  const research = {
    sources: [],
    listings: [
      makeListing({
        retailer: 'Bundle',
        category: 'bundle',
        effectivePrice: 1700,
        price: 1700
      }),
      makeListing({ retailer: 'Cheap', category: 'base', effectivePrice: 1400, price: 1400 })
    ]
  }
  const lastAlerts = new Map([['bundle|bundle', { effectivePrice: 1710, sentAt: 'x' }]])
  const result = decide({ item, research, lastAlerts })
  assert.equal(result.best.listing.retailer, 'Cheap')
  assert.equal(result.suppressed.length, 1)
  assert.equal(result.suppressed[0].listing.retailer, 'Bundle')
  assert.match(result.suppressed[0].reason, /already alerted at \$1,710/)
})

test('decide returns a null best when everything is deduped or unqualified', () => {
  const research = {
    sources: [],
    listings: [makeListing({ effectivePrice: 1900, price: 1900 })]
  }
  const result = decide({ item, research, lastAlerts: new Map() })
  assert.equal(result.best, null)
  assert.equal(result.qualified.length, 0)
  assert.equal(result.lowest.effectivePrice, 1900)
})

test('decide returns null lowest with no eligible listings', () => {
  const result = decide({ item, research: { sources: [], listings: [] }, lastAlerts: new Map() })
  assert.equal(result.lowest, null)
  assert.equal(result.best, null)
})

test('formatDealMessage builds the title, lines, priority, and click', () => {
  const listing = makeListing({
    title: 'Springfree O77 Sports Bundle',
    price: 1699,
    wasPrice: 1999,
    effectivePrice: 1599,
    isClearance: true,
    verified: false,
    deliveryCost: 99,
    notes: 'Black, free install'
  })
  const result = formatDealMessage({ item, listing })
  assert.equal(result.title, 'Springfree Medium Oval deal found')
  assert.equal(result.priority, 4)
  assert.equal(result.click, listing.url)
  assert.deepEqual(result.message.split('\n'), [
    'Model: Springfree O77 Sports Bundle',
    'Price: $1,699 (was $1,999)',
    'Retailer: Acme',
    'Notes: Black, free install; clearance; effective $1,599 after promo; unverified; delivery $99'
  ])
})

test('formatDealMessage omits the notes line when there is nothing to say', () => {
  const result = formatDealMessage({ item, listing: makeListing() })
  assert.deepEqual(result.message.split('\n'), [
    'Model: Widget',
    'Price: $1,500',
    'Retailer: Acme'
  ])
})

test('formatDealMessage sanitises dashes and emoji but keeps Karcher', () => {
  const listing = makeListing({ title: 'K7 — Smart \u{1F525}', notes: 'a – b' })
  const result = formatDealMessage({ item: { name: 'Kärcher K7' }, listing })
  assert.equal(result.title, 'Kärcher K7 deal found')
  assert.ok(!/[–—]/.test(result.message))
  assert.ok(!result.message.includes('\u{1F525}'))
  assert.match(result.message, /Model: K7 - Smart/)
})

test('formatHeartbeatMessage reports the lowest listing and failed sources', () => {
  const result = formatHeartbeatMessage({
    item,
    lowest: makeListing({ effectivePrice: 1450 }),
    failedSources: [{ name: 'Myer', status: 'blocked' }],
    qualifiedCount: 0
  })
  assert.equal(result.title, 'Springfree Medium Oval still tracking')
  assert.equal(result.priority, 2)
  assert.equal(result.click, 'https://acme.example/widget')
  assert.match(result.message, /Lowest seen: \$1,450 at Acme/)
  assert.match(result.message, /Failed sources: Myer/)
  assert.doesNotMatch(result.message, /bot check/)
})

test('formatHeartbeatMessage names the sites that asked for a bot check', () => {
  const result = formatHeartbeatMessage({
    item,
    lowest: null,
    failedSources: [
      { name: 'Myer', status: 'blocked', note: 'CAPTCHA page' },
      { name: 'JB Hi-Fi', status: 'blocked', note: 'HTTP 429' }
    ],
    qualifiedCount: 0
  })
  assert.match(result.message, /Failed sources: Myer, JB Hi-Fi\nAsked for a bot check: Myer/)
})

test('formatHeartbeatMessage handles no listings and no click', () => {
  const result = formatHeartbeatMessage({
    item,
    lowest: null,
    failedSources: [],
    qualifiedCount: 0
  })
  assert.equal('click' in result, false)
  assert.match(result.message, /No in-stock listings/)
})

test('lowestPerRetailerPerDay keeps the lowest per day, retailer, and category', () => {
  const rows = [
    {
      checkedAt: '2026-11-10T21:00:00Z',
      retailer: 'Acme',
      category: 'base',
      effectivePrice: 1500,
      verified: 1
    },
    {
      checkedAt: '2026-11-11T02:00:00Z',
      retailer: 'acme ',
      category: 'base',
      effectivePrice: 1450,
      verified: 0
    },
    {
      checkedAt: '2026-11-11T02:00:00Z',
      retailer: 'Beta',
      category: 'base',
      effectivePrice: 1400,
      verified: 1
    },
    {
      checkedAt: '2026-11-12T02:00:00Z',
      retailer: 'Acme',
      category: 'base',
      effectivePrice: 1550,
      verified: 1
    },
    {
      checkedAt: '2026-11-12T02:00:00Z',
      retailer: 'Acme',
      category: 'bundle',
      effectivePrice: null,
      verified: 1
    }
  ]
  const result = lowestPerRetailerPerDay(rows)
  assert.deepEqual(result.map(({ day, retailer, lowest, verified }) =>
    ({ day, retailer: retailer.trim().toLowerCase(), lowest, verified })), [
    { day: '2026-11-11', retailer: 'beta', lowest: 1400, verified: true },
    { day: '2026-11-11', retailer: 'acme', lowest: 1450, verified: false },
    { day: '2026-11-12', retailer: 'acme', lowest: 1550, verified: true }
  ])
})

test('lowestPerRetailerPerDay groups by Sydney day', () => {
  const rows = [
    {
      checkedAt: '2026-11-10T20:00:00Z',
      retailer: 'Acme',
      category: 'base',
      effectivePrice: 1500,
      verified: 1
    }
  ]
  assert.equal(lowestPerRetailerPerDay(rows)[0].day, '2026-11-11')
})

const k7Item = {
  name: 'Karcher K7',
  categories: [{ id: 'k7' }],
  rules: { k7: { maxPrice: 600 } },
  sources: { sites: [{ name: 'Bunnings' }] },
  dedupe: { minDrop: 25 }
}

const fakeBunnings = makeListing({
  retailer: 'Bunnings', title: 'Karcher K7', category: 'k7', price: 9, effectivePrice: 9,
  verified: false, url: 'https://evil.example/',
  notes: 'URGENT: buy now at https://evil.example/pay'
})

const k7Research = (listings) => ({ sources: [], listings })

test('isImplausiblePrice flags zero, negative, and too-cheap prices against RRP or cap', () => {
  const rule = { maxPrice: 600 }
  assert.equal(isImplausiblePrice({ listing: makeListing({ price: 0 }), rule }), true)
  assert.equal(isImplausiblePrice({
    listing: makeListing({ price: -50, effectivePrice: -50 }), rule
  }), true)
  assert.equal(isImplausiblePrice({
    listing: makeListing({ price: 299, effectivePrice: 299 }), rule
  }), true)
  assert.equal(isImplausiblePrice({
    listing: makeListing({ price: 300, effectivePrice: 300 }), rule
  }), false)
  const rrpRule = { maxPrice: 1600, rrp: 1999 }
  assert.equal(isImplausiblePrice({
    listing: makeListing({ price: 799, effectivePrice: 799 }), rule: rrpRule
  }), true)
  assert.equal(isImplausiblePrice({
    listing: makeListing({ price: 1537.29, effectivePrice: 1537.29 }), rule: rrpRule
  }), false)
  assert.equal(isImplausiblePrice({ listing: makeListing({ price: 5 }), rule: {} }), false)
})

test('decide holds back a $9 Bunnings listing on evil.example as a check notice', () => {
  const result = decide({
    item: k7Item, research: k7Research([fakeBunnings]), lastAlerts: new Map()
  })
  assert.equal(result.best, null)
  assert.equal(result.checkNotice.host, 'evil.example')
  assert.deepEqual(result.checkNotice.concerns, [
    'Bunnings named but the site is evil.example',
    '$9 is under $300, too cheap to be likely'
  ])
  assert.match(result.suppressed[0].reason, /^check before buying: Bunnings named/)
  const message = formatCheckMessage({ item: k7Item, notice: result.checkNotice })
  assert.equal(message.priority, 2)
  assert.equal(message.click, undefined)
  assert.equal(message.actions, undefined)
  assert.equal(message.title, 'Karcher K7: check this listing')
  assert.match(message.message, /^Site: evil\.example\n/)
  assert.doesNotMatch(message.message, /URGENT|evil\.example\/pay/)
})

test('decide alerts normally for Bunnings on bunnings.com.au at a real price', () => {
  const real = { ...fakeBunnings, price: 450, effectivePrice: 450,
    url: 'https://www.bunnings.com.au/karcher-k7_p0631836' }
  const result = decide({
    item: k7Item, research: k7Research([fakeBunnings, real]), lastAlerts: new Map()
  })
  assert.equal(result.best.listing.url, real.url)
  assert.equal(result.checkNotice.listing.url, 'https://evil.example/')
  assert.equal(formatDealMessage({ item: k7Item, listing: real }).priority, 4)
})

test('decide flags a trusted site at an implausible price and dedupes check notices', () => {
  const cheap = { ...fakeBunnings, url: 'https://www.bunnings.com.au/k7' }
  const first = decide({ item: k7Item, research: k7Research([cheap]), lastAlerts: new Map() })
  assert.equal(first.best, null)
  assert.deepEqual(first.checkNotice.concerns, ['$9 is under $300, too cheap to be likely'])
  const lastCheckAlerts = new Map([['bunnings|k7', { effectivePrice: 9, sentAt: 'x' }]])
  const again = decide({
    item: k7Item, research: k7Research([cheap]), lastAlerts: new Map(), lastCheckAlerts
  })
  assert.equal(again.checkNotice, null)
  assert.equal(again.suppressed.length, 1)
})
