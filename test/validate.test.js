import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LISTINGS, MAX_SOURCES, TEXT_LIMITS, validateResearch } from '../src/validate.js'

const categoryIds = ['bundle', 'base']

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
  evidence: 'seen on page',
  notes: '',
  ...overrides
})

const makeData = (overrides = {}) => ({
  checkedAt: '2026-11-10T21:45:00.000Z',
  sources: [{ name: 'Acme', status: 'ok', note: '' }],
  listings: [makeListing()],
  ...overrides
})

const validate = (data) => validateResearch({ data, categoryIds })

test('accepts good research', () => {
  const result = validate(makeData())
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.value.listings[0].retailer, 'Acme')
})

test('accepts a reject listing with null numbers and null url', () => {
  const reject = makeListing({
    category: 'reject',
    price: null,
    effectivePrice: null,
    url: null,
    rejectReason: 'NZ listing',
    inStock: false
  })
  assert.equal(validate(makeData({ listings: [reject] })).ok, true)
})

test('accepts null note and notes', () => {
  const data = makeData({
    sources: [{ name: 'Acme', status: 'blocked', note: null }],
    listings: [makeListing({ notes: null, rejectReason: null })]
  })
  const result = validate(data)
  assert.equal(result.ok, true)
  assert.equal(result.value.sources[0].note, '')
})

test('rejects non-object input', () => {
  assert.equal(validate('nope').ok, false)
  assert.equal(validate(null).ok, false)
  assert.equal(validate([]).ok, false)
})

test('rejects a missing checkedAt', () => {
  const data = makeData()
  delete data.checkedAt
  assert.deepEqual(validate(data).errors, ['checkedAt: expected ISO date string'])
})

test('rejects non-array sources and listings', () => {
  const result = validate(makeData({ sources: {}, listings: 'x' }))
  assert.deepEqual(result.errors, ['sources: expected array', 'listings: expected array'])
})

test('rejects a bad source status', () => {
  const result = validate(makeData({ sources: [{ name: 'A', status: 'great', note: '' }] }))
  assert.match(result.errors[0], /^sources\[0\]\.status: expected one of ok, blocked/)
})

test('reports a string price with an indexed path', () => {
  const listings = [makeListing(), makeListing(), makeListing({ price: '1500' })]
  const result = validate(makeData({ listings }))
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, ['listings[2].price: expected number or null'])
  assert.equal(result.value, null)
})

test('rejects an unknown category', () => {
  const result = validate(makeData({ listings: [makeListing({ category: 'mystery' })] }))
  assert.match(result.errors[0], /^listings\[0\]\.category: expected one of bundle, base, reject/)
})

test('rejects a non-boolean flag', () => {
  const result = validate(makeData({ listings: [makeListing({ verified: 'yes' })] }))
  assert.deepEqual(result.errors, ['listings[0].verified: expected boolean'])
})

test('rejects a url that is not http or https', () => {
  const result = validate(makeData({ listings: [makeListing({ url: 'ftp://x.example/a' })] }))
  assert.deepEqual(result.errors, ['listings[0].url: expected public http(s) URL or null'])
})

test('rejects listing urls that are private, use credentials, or hide the host', () => {
  for (const url of [
    'https://bunnings.com.au@evil.example/k7', 'http://192.168.1.50:5000/',
    'http://127.0.0.1:4280/api/settings', 'https://[::1]/', 'http://2130706433/',
    'http://nas.local/', 'javascript:alert(1)'
  ]) {
    const result = validate(makeData({ listings: [makeListing({ url })] }))
    assert.deepEqual(result.errors, ['listings[0].url: expected public http(s) URL or null'], url)
  }
})

test('stores the normalised href of a public listing url', () => {
  const result = validate(makeData({
    listings: [makeListing({ url: ' https://WWW.Bunnings.com.au/p/123 ' })]
  }))
  assert.equal(result.value.listings[0].url, 'https://www.bunnings.com.au/p/123')
})

test('rejects NaN and Infinity prices', () => {
  const listings = [makeListing({ price: Number.NaN }), makeListing({ deliveryCost: Infinity })]
  const result = validate(makeData({ listings }))
  assert.equal(result.errors.length, 2)
})

test('rejects a non-object listing', () => {
  const result = validate(makeData({ listings: [42] }))
  assert.deepEqual(result.errors, ['listings[0]: expected object'])
})

test('collects every error', () => {
  const listings = [makeListing({ retailer: '', inStock: 1 })]
  const result = validate(makeData({ checkedAt: 5, listings }))
  assert.equal(result.errors.length, 3)
})

test('part marks an accessory listing and allows the accessory category', () => {
  const data = makeData({
    listings: [makeListing({ category: 'accessory', part: 'wheels' })]
  })
  const result = validateResearch({ data, categoryIds, partIds: ['wheels', 'sunshade'] })
  assert.equal(result.ok, true)
  assert.equal(result.value.listings[0].part, 'wheels')
})

test('accessory category without a part is rejected', () => {
  const result = validateResearch({
    data: makeData({ listings: [makeListing({ category: 'accessory' })] }),
    categoryIds,
    partIds: ['wheels']
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /listings\[0\]\.category: expected one of/)
})

test('part must be one of the kit part ids when ids are given', () => {
  const result = validateResearch({
    data: makeData({ listings: [makeListing({ category: 'accessory', part: 'roof' })] }),
    categoryIds,
    partIds: ['wheels']
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /listings\[0\]\.part: expected one of wheels/)
})

test('part defaults to null and must be a string', () => {
  assert.equal(validateResearch({ data: makeData(), categoryIds }).value.listings[0].part, null)
  const result = validateResearch({
    data: makeData({ listings: [makeListing({ part: 5 })] }), categoryIds
  })
  assert.match(result.errors[0], /listings\[0\]\.part: expected string or null/)
})

test('rejects zero, negative, and huge prices and negative delivery', () => {
  const result = validate(makeData({
    listings: [
      makeListing({ price: 0 }),
      makeListing({ price: -50 }),
      makeListing({ effectivePrice: 200001 }),
      makeListing({ wasPrice: 0 }),
      makeListing({ deliveryCost: -1 })
    ]
  }))
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, [
    'listings[0].price: expected price above 0 and at most 200000, or null',
    'listings[1].price: expected price above 0 and at most 200000, or null',
    'listings[2].effectivePrice: expected price above 0 and at most 200000, or null',
    'listings[3].wasPrice: expected price above 0 and at most 200000, or null',
    'listings[4].deliveryCost: expected amount from 0 to 200000, or null'
  ])
})

test('accepts free delivery and the top of the price range', () => {
  const result = validate(makeData({
    listings: [makeListing({ price: 200000, effectivePrice: 200000, deliveryCost: 0 })]
  }))
  assert.equal(result.ok, true)
})

test('clips long text fields instead of failing', () => {
  const huge = 'A'.repeat(5_000_000)
  const result = validate(makeData({
    sources: [{ name: 'Acme', status: 'ok', note: huge }],
    listings: [makeListing({ notes: huge, title: huge, retailer: huge, evidence: huge })]
  }))
  assert.equal(result.ok, true)
  const [listing] = result.value.listings
  assert.equal(listing.notes.length, TEXT_LIMITS.notes)
  assert.ok(listing.notes.endsWith('...'))
  assert.equal(listing.title.length, TEXT_LIMITS.title)
  assert.equal(listing.retailer.length, TEXT_LIMITS.retailer)
  assert.equal(listing.evidence.length, TEXT_LIMITS.evidence)
  assert.equal(result.value.sources[0].note.length, TEXT_LIMITS.sourceNote)
})

test('keeps the first listings and sources past the caps and warns', () => {
  const result = validate(makeData({
    sources: Array.from({ length: 70 }, () => ({ name: 'Acme', status: 'ok', note: '' })),
    listings: Array.from({ length: 250 }, () => makeListing())
  }))
  assert.equal(result.ok, true)
  assert.equal(result.value.listings.length, MAX_LISTINGS)
  assert.equal(result.value.sources.length, MAX_SOURCES)
  assert.deepEqual(result.warnings, [
    'sources: kept the first 60 of 70', 'listings: kept the first 200 of 250'
  ])
})

test('keeps a public source url and drops a bad one without failing the run', () => {
  const result = validate(makeData({
    sources: [
      { name: 'Acme', status: 'blocked', note: 'CAPTCHA', url: ' https://Acme.com.au/p/1 ' },
      { name: 'Lan', status: 'error', note: '', url: 'http://192.168.1.2/admin' },
      { name: 'Odd', status: 'ok', note: '', url: 'javascript:alert(1)' },
      { name: 'Old', status: 'ok', note: '' }
    ]
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.sources.map(({ url }) => url),
    ['https://acme.com.au/p/1', undefined, undefined, undefined])
  assert.equal(Object.hasOwn(result.value.sources[3], 'url'), false)
})
