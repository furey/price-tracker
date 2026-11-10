import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDealMessage, qualify } from '../src/decide.js'
import { openDb, insertListings, startRun, runListings } from '../src/db.js'
import { validateItem } from '../src/item-validate.js'
import { buildPrompt } from '../src/research.js'
import { pricePerUnit } from '../src/unit-price.js'
import { validateResearch } from '../src/validate.js'

const listing = (overrides = {}) => ({
  retailer: 'Chemist Warehouse', title: 'Huggies Nappies Size 4 (108 pack)', category: 'pack',
  rejectReason: null, price: 54, wasPrice: null, effectivePrice: 49.68, deliveryCost: null,
  isClearance: false, inStock: true, verified: true, url: 'https://www.chemistwarehouse.com.au/p',
  evidence: '$54', notes: '', unitCount: 108, ...overrides
})

const item = () => ({
  id: 'nappies',
  name: 'Huggies size 4',
  product: 'Huggies Ultimate nappies, size 4',
  unit: { name: 'nappy' },
  categories: [{ id: 'pack', description: 'Any pack size' }],
  rules: { pack: { maxPrice: 30, maxPricePerUnit: 0.5 } },
  schedules: [],
  ntfy: { server: 'https://ntfy.sh', topic: 'topic-1' },
  sources: { sites: [{ name: 'Chemist Warehouse' }], searches: ['huggies size 4'] }
})

test('price per unit uses the price after promos and needs a positive count', () => {
  assert.equal(pricePerUnit(listing()), 0.46)
  assert.equal(pricePerUnit(listing({ effectivePrice: null })), 0.5)
  assert.equal(pricePerUnit(listing({ unitCount: null })), null)
  assert.equal(pricePerUnit(listing({ unitCount: 0 })), null)
})

test('a listing qualifies on its per-unit price even above the whole-price cap', () => {
  const rule = item().rules.pack
  assert.deepEqual(qualify({ listing: listing(), rule, unit: 'nappy' }),
    { qualifies: true, reasons: ['$0.46 per nappy, under $0.50'] })
  const dear = qualify({ listing: listing({ unitCount: 54 }), rule, unit: 'nappy' })
  assert.equal(dear.qualifies, false)
  assert.deepEqual(dear.reasons, ['$49.68 over $30 cap', '$0.92 per nappy, over $0.50'])
  const uncounted = qualify({ listing: listing({ unitCount: null }), rule, unit: 'nappy' })
  assert.deepEqual(uncounted.reasons, ['$49.68 over $30 cap'])
})

test('the deal message gives the price per unit', () => {
  const { message } = formatDealMessage({ item: item(), listing: listing() })
  assert.match(message, /Per nappy: \$0\.46 \(108 in the listing\)/)
  const plain = formatDealMessage({ item: { ...item(), unit: undefined }, listing: listing() })
  assert.doesNotMatch(plain.message, /Per nappy/)
})

test('research replies may carry a unit count, which is kept only when given', () => {
  const data = (extra) => ({
    checkedAt: '2026-11-10T00:00:00Z', sources: [], listings: [listing(extra)]
  })
  assert.equal(validateResearch({ data: data({}), categoryIds: ['pack'] }).value.listings[0]
    .unitCount, 108)
  const without = validateResearch({ data: data({ unitCount: null }), categoryIds: ['pack'] })
  assert.equal('unitCount' in without.value.listings[0], false)
  const bad = validateResearch({ data: data({ unitCount: -3 }), categoryIds: ['pack'] })
  assert.deepEqual(bad.errors, ['listings[0].unitCount: expected number from 0 to 100000'])
})

test('the prompt asks for unit counts only for an item compared per unit', () => {
  const now = new Date('2026-11-10T00:00:00Z')
  assert.match(buildPrompt({ item: item(), now }), /UNITS\nCompare listings by price per nappy/)
  assert.doesNotMatch(buildPrompt({ item: { ...item(), unit: undefined }, now }), /UNITS/)
})

test('the unit name and per-unit caps are validated, and counts are stored', () => {
  assert.deepEqual(validateItem(item()), [])
  assert.deepEqual(validateItem({ ...item(), unit: { name: '' } }),
    ['unit.name: expected a short name such as "nappy", up to 30 characters'])
  const badRule = { ...item(), rules: { pack: { maxPricePerUnit: -1 } } }
  assert.deepEqual(validateItem(badRule),
    ['rules.pack.maxPricePerUnit: expected a positive number or null'])
  const db = openDb(':memory:')
  const runId = startRun({ db, itemId: 'nappies', trigger: 'tick', startedAt: '2026-11-10' })
  insertListings({ db, runId, itemId: 'nappies', checkedAt: '2026-11-10', listings: [listing()] })
  assert.equal(runListings({ db, runId })[0].unitCount, 108)
})
